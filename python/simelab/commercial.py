"""
commercial.py — Commercial intent and co-optation analysis.

Analyzes tweets for specific product/service keywords (e.g., Furniture, Computers, Betting)
and computes commercial percentages, trends, and optionally uses the LLM API to
analyze narrative co-optation strategies.

Two-phase intelligent search:
  Phase 1 — Fuzzy + regex scan: collect hits, sample context rows, and entity frequencies.
  Phase 2 — Entity resolution: ask the LLM "HOW was this term used? What did the user mean?"
             (e.g. user types "Liberty Shoes", system finds 'liberty' hitting 'liberty_stores'
              32× in source/target columns → LLM resolves to '@liberty_stores: shoe vendor')
"""

import json
import urllib.request
import urllib.error
import re
from pathlib import Path
from typing import Dict, Any, Optional, List
import pandas as pd
import os

def read_env_key(key: str, default: str = "") -> str:
    # Search paths for .env
    paths = [
        Path(__file__).parent.parent.parent.parent / ".env",
        Path(__file__).parent.parent.parent / ".env",
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent / ".env",
        Path.cwd() / ".env",
    ]
    for p in paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            k, v = line.split("=", 1)
                            if k.strip() == key:
                                return v.strip().strip("'").strip('"')
            except Exception:
                pass
    return os.environ.get(key, default)


def compile_keyword_pattern(k: str) -> re.Pattern:
    k = k.lower().strip()
    words_in_phrase = [re.escape(w) for w in re.split(r'[\s_-]+', k) if w]
    if len(words_in_phrase) > 1:
        phrase_pattern = r"[\s_-]+".join(words_in_phrase)
        return re.compile(rf"(?<![a-zA-Z0-9]){phrase_pattern}", re.IGNORECASE)
    else:
        # Strip leading/trailing special characters like @, # to check length
        clean_kw = k.lstrip('@#')
        if len(clean_kw) < 4:
            return re.compile(rf"(?<![a-zA-Z0-9]){re.escape(k)}(?![a-zA-Z0-9])", re.IGNORECASE)
        else:
            return re.compile(rf"(?<![a-zA-Z0-9]){re.escape(k)}", re.IGNORECASE)


def expand_and_decompose_keywords(keywords_list: list) -> list:
    expanded = []
    stop_words = {
        "and", "their", "the", "a", "of", "to", "for", "in", "on", "at", 
        "with", "is", "are", "it", "this", "that", "these", "those", 
        "or", "but", "an", "by", "from", "up", "about", "into", "over", "after"
    }
    for kw in keywords_list:
        kw_clean = kw.strip()
        if not kw_clean:
            continue
        expanded.append(kw_clean)
        
        # Decompose handles/hashtags
        if kw_clean.startswith('@') or kw_clean.startswith('#'):
            stripped = kw_clean.lstrip('@#')
            if len(stripped) >= 3:
                expanded.append(stripped)
                
        # Decompose multi-word phrases
        words = [w.strip() for w in re.split(r'[^a-zA-Z0-9_]', kw_clean) if w.strip()]
        if len(words) > 1:
            for w in words:
                if len(w) >= 3 and w.lower() not in stop_words:
                    expanded.append(w)
                    
    # Deduplicate while preserving order (case-insensitive)
    seen = set()
    deduped = []
    for item in expanded:
        item_lower = item.lower()
        if item_lower not in seen:
            seen.add(item_lower)
            deduped.append(item)
    return deduped


class CommercialAnalyzer:
    """
    Analyzes commercial content in a dataset by searching for specific product and
    service keywords, computing frequencies, extracting trends, and requesting LLM insights.

    Uses a two-phase approach:
      1. Scan: collect hits + context samples + entity frequency data.
      2. Resolve: determine what entity/account the user actually meant to search for,
         using offline frequency analysis and optionally an LLM call.
    """

    KEYWORDS = {
        "Furniture": [r"\bfurniture(s)?\b", r"\bsofa(s)?\b", r"\bcouch(es)?\b", r"\bbed(s)?\b", r"\bdesk(s)?\b", r"\bwardrobe(s)?\b"],
        "Computers/Tech": [r"\bcomputer(s)?\b", r"\blaptop(s)?\b", r"\bpc\b", r"\bmacbook(s)?\b", r"\bmonitor(s)?\b", r"\bkeyboard(s)?\b", r"\bmouse\b", r"\baccessories\b", r"\bphones\b", r"\biphone(s)?\b", r"\bsmartphone(s)?\b"],
        "Shoes": [r"\bshoe(s)?\b", r"\bsneaker(s)?\b", r"\bboot(s)?\b", r"\bkicks\b", r"\bheels\b", r"\bfootwear\b"],
        "Betting/Gambling": [r"\bbet(s|ting)?\b", r"\bgambl(e|ing)\b", r"\bcasino(s)?\b", r"\bodds\b", r"\bjackpot\b", r"\baviator\b", r"\bmultibet\b", r"\bsportpesa\b", r"\bodibets\b", r"\bbetika\b"],
        "Vehicles": [r"\bvehicle(s)?\b", r"\bcar(s)?\b", r"\bmotorbike(s)?\b", r"\bboda(boda)?\b", r"\bspare parts\b", r"\btyres\b"],
        "Clothing": [r"\bclothing\b", r"\bclothes\b", r"\bpullneck(s)?\b", r"\bjacket(s)?\b", r"\bt-?shirt(s)?\b", r"\bdress(es)?\b", r"\bhump(s)?\b", r"\btrouser(s)?\b", r"\bhoodie(s)?\b", r"\bmtumba\b"],
        "Airtime": [r"\bairtime\b", r"\bdata bundles\b", r"\bcredit\b", r"\brecharge\b", r"\bsafaricom\b", r"\bairtel\b"],
        "Sales Call/DM": [r"\bcall\b", r"\bcall (now|me)\b", r"\bdm\b", r"\binbox\b", r"\btext\b", r"\bwhatsapp\b", r"\b07\d{8}\b", r"\b01\d{8}\b"],
        "Delivery/Logistics": [r"\bdelivery\b", r"\bdeliveries\b", r"\bdispatch\b", r"\bshipping\b", r"\bdoorstep\b", r"\bparcel(s)?\b"],
        "CBD": [r"\bcbd\b", r"\bnairobi\b", r"\btown\b", r"\bshop\b", r"\bstore\b"],
        "Pricing/Payment": [r"\baffordable\b", r"\bcheap\b", r"\bpayment\b", r"\bpay(ment)? methods?\b", r"\bmpesa\b", r"\bm-pesa\b", r"\btill\b", r"\bpaybill\b", r"\bcash on delivery\b", r"\bsh(illing)?s?\b", r"\bksh(s)?\b", r"\bprice(s)?\b", r"\bdiscount(s)?\b", r"\bsale\b"]
    }

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.df: Optional[pd.DataFrame] = None

    def _load_tweets(self) -> pd.DataFrame:
        filepath = Path(self.filepath)
        if not filepath.exists():
            raise FileNotFoundError(f"File not found: {self.filepath}")

        if filepath.suffix.lower() in (".xlsx", ".xls"):
            try:
                df = pd.read_excel(filepath, sheet_name="Edges", header=1)
            except Exception:
                try:
                    df = pd.read_excel(filepath, header=1)
                except Exception:
                    df = pd.read_excel(filepath)
        else:
            df = pd.read_csv(filepath)

        df.columns = [str(c).strip() for c in df.columns]

        # Case-insensitive column matching
        col_lower_map = {c.lower(): c for c in df.columns}

        date_col = next((col_lower_map[k] for k in ("date", "relationship date (utc)", "timestamp", "created_at") if k in col_lower_map), None)
        text_col = next((col_lower_map[k] for k in ("tweet", "text", "content", "tooltip", "label") if k in col_lower_map), None)

        if not text_col:
            raise ValueError(f"No tweet text column found. Columns present: {df.columns.tolist()}")

        df = df.dropna(subset=[text_col])
        df[text_col] = df[text_col].astype(str).str.strip()

        src_col = next((col_lower_map[k] for k in ("vertex 1", "source", "from", "sender") if k in col_lower_map), None)
        tgt_col = next((col_lower_map[k] for k in ("vertex 2", "target", "to", "receiver") if k in col_lower_map), None)

        if date_col:
            df["parsed_date"] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.dropna(subset=["parsed_date"])
            df = df.sort_values("parsed_date")
        else:
            df["parsed_date"] = pd.to_datetime("now")

        cols_to_keep = [text_col, "parsed_date"]
        rename_dict = {text_col: "tweet_text"}
        if src_col:
            cols_to_keep.append(src_col)
            rename_dict[src_col] = "source"
        if tgt_col:
            cols_to_keep.append(tgt_col)
            rename_dict[tgt_col] = "target"

        self.df = df[cols_to_keep].rename(columns=rename_dict)
        
        self.src_col_name = src_col
        self.tgt_col_name = tgt_col
        self.date_col_name = date_col
        self.text_col_name = text_col
        
        dup_cols = ["tweet_text"]
        if src_col:
            dup_cols.append("source")
        if tgt_col:
            dup_cols.append("target")
        self.df = self.df.drop_duplicates(subset=dup_cols)
        
        print(f"[CommercialLoader] Loaded {len(self.df)} tweets. Source column: {src_col}, Target column: {tgt_col}, Date column: {date_col}")
        return self.df

    def _get_top_entities(self) -> Dict[str, list]:
        if self.df is None or self.df.empty:
            return {"usernames": [], "terms": []}
            
        usernames = []
        if "source" in self.df.columns:
            usernames.extend(self.df["source"].dropna().astype(str).tolist())
        if "target" in self.df.columns:
            usernames.extend(self.df["target"].dropna().astype(str).tolist())
            
        from collections import Counter
        user_counts = Counter(usernames)
        top_users = [u for u, _ in user_counts.most_common(150)]
        
        words = []
        for text in self.df["tweet_text"].dropna():
            for w in re.split(r'[^a-zA-Z0-9_#@]', str(text)):
                if len(w) >= 4:
                    words.append(w.lower())
        word_counts = Counter(words)
        top_words = [w for w, _ in word_counts.most_common(150) if not w.startswith('http')]
        
        return {"usernames": top_users, "terms": top_words}

    # ─── Phase 2: Offline entity resolution ──────────────────────────────────

    def _resolve_entity_offline(
        self,
        user_query: str,
        terms_with_hits: List[tuple],
        entity_freq: Dict[str, int],
    ) -> Dict[str, Any]:
        """
        Offline (no LLM) entity resolution using hit-frequency analysis.
        Finds the most common entity that appeared in source/target columns
        when the search terms matched, giving a best-guess of what the user meant.

        Args:
            user_query: The original user search term (e.g. "Liberty Shoes")
            terms_with_hits: List of (term, hit_count, context_samples) tuples
            entity_freq: Dict of {entity_name: count} from source/target matching

        Returns:
            Dict with resolved_entity, confidence, reasoning, total_hits etc.
        """
        total_hits = sum(h for _, h, _ in terms_with_hits)

        if not entity_freq:
            # No source/target entity data — fall back to highest-hit term
            best = max(terms_with_hits, key=lambda x: x[1]) if terms_with_hits else (user_query, 0, [])
            return {
                "resolved_entity": best[0],
                "resolved_entity_type": "term",
                "intent_summary": None,
                "confidence": 0.4,
                "reasoning": (
                    f"No entity column data (source/target) available for '{user_query}'. "
                    f"Highest-hit term: '{best[0]}' ({best[1]} hits)."
                ),
                "total_hits": total_hits,
            }

        # Find most common entity matched in source/target columns
        sorted_ents = sorted(entity_freq.items(), key=lambda x: x[1], reverse=True)
        best_entity, best_count = sorted_ents[0]
        total_entity_hits = sum(c for _, c in sorted_ents)
        # Confidence: how dominant is the best entity among all entity matches?
        dominance = best_count / max(total_entity_hits, 1)
        confidence = round(min(0.92, dominance * 0.7 + 0.2), 2)

        return {
            "resolved_entity": best_entity,
            "resolved_entity_type": "account",
            "intent_summary": None,
            "confidence": confidence,
            "reasoning": (
                f"'{best_entity}' was the most frequent entity matching '{user_query}' — "
                f"found {best_count} times out of {total_entity_hits} source/target hits "
                f"(dominance: {round(dominance * 100)}%). Total tweet hits: {total_hits}."
            ),
            "total_hits": total_hits,
        }

    def _resolve_entity_intent(
        self,
        user_query: str,
        terms_with_contexts: Dict[str, List[str]],
        entity_freq: Dict[str, int],
        api_key: str,
    ) -> Optional[Dict[str, Any]]:
        """
        LLM-powered Phase 2 intent resolution.

        Presents the LLM with HOW the matched terms were actually used in the real
        data rows — which accounts (source/target) contained them, and what the tweet
        text looked like — and asks it to determine what entity the user actually meant.

        For example: user types "Liberty Shoes", system finds 'liberty' hits 35 rows
        and 32 of those have 'liberty_stores' as the source/target. The LLM sees this
        and resolves to 'liberty_stores' (a shoe store), with an explanation.
        """
        if not terms_with_contexts and not entity_freq:
            return None

        # Build context block
        context_lines: List[str] = []
        for term, samples in terms_with_contexts.items():
            context_lines.append(f"  • Term '{term}' matched in these actual dataset rows:")
            for s in samples[:5]:
                context_lines.append(f"      - {s}")

        top_ents = sorted(entity_freq.items(), key=lambda x: x[1], reverse=True)[:10]
        entity_str = (
            ", ".join(f"'{e}' ({c}×)" for e, c in top_ents)
            if top_ents
            else "none found in source/target columns"
        )

        ctx_block = "\n".join(context_lines) if context_lines else "  (matches found only in tweet body text)"

        prompt = f"""You are a social media intelligence analyst at SIMElab Africa.

A researcher searched for: "{user_query}"

Here are the actual matching rows found in the dataset:
{ctx_block}

Top matching accounts/usernames found in the source and target relationship columns:
{entity_str}

YOUR TASK:
Examine HOW the matched terms appear in the real data above. Look at the actual usernames
and how the terms are used in context, then determine what specific account or entity the
user was searching for.

Pattern examples:
- If 'liberty' appears almost exclusively as the username 'liberty_stores', the user meant
  that specific account. Look at it selling shoes → it's a shoe vendor.
- If '@miondokoo' was typed but data shows 'miondkoo' (slight typo), resolve to 'miondkoo'.
- If 'Miato Technologies' appears as 'MiatoTechnolo' in source/target, resolve to that.
- If a handle like 'crazydreamer254' appears frequently as a target (mentioned), it's an
  influencer or commercial account being tagged.

Return ONLY this JSON (no markdown, no extra text):
{{
  "resolved_entity": "<the exact username/entity from the data the user most likely meant>",
  "resolved_entity_type": "<'account', 'brand', 'hashtag', or 'general_topic'>",
  "intent_summary": "<1 sentence: what this entity does or sells, based on the data contexts above>",
  "confidence": <float 0.0-1.0, how confident you are>,
  "reasoning": "<2-3 sentences explaining what patterns in the data led you to this conclusion>"
}}"""

        return self._call_llm(prompt, api_key)

    # ─── Main analysis pipeline ───────────────────────────────────────────────

    def analyze(self, api_key: str = "", base_keywords: str = "", sample_size: int = 50) -> Dict[str, Any]:
        """
        Run the full commercial intent analysis.

        Two-phase intelligent search when base_keywords is provided:
          Phase 1 — Regex/fuzzy scan of all rows, collecting:
                     * hit counts per term
                     * sample context strings per term (up to 6)
                     * entity frequency maps (which source/target values matched)
          Phase 2 — For each user keyword with hits, resolve what entity they meant:
                     * Offline: frequency-based (always runs)
                     * LLM: context-aware resolution (runs if api_key provided)
        """
        self._load_tweets()
        if self.df is None or self.df.empty:
            raise ValueError("No tweets found for analysis.")

        total_tweets = len(self.df)
        has_source = "source" in self.df.columns
        has_target = "target" in self.df.columns

        user_keywords: List[str] = [k.strip() for k in base_keywords.split(",") if k.strip()]
        expanded_keywords: List[str] = []
        compiled_patterns: Dict[str, list] = {}
        category_counts: Dict[str, int] = {}

        if base_keywords:
            # ── Phase 0: LLM keyword expansion with dataset context ──────────
            if api_key:
                context = self._get_top_entities()
                top_users_str = ", ".join(context["usernames"][:100])
                top_terms_str = ", ".join(context["terms"][:100])

                prompt_expand = f"""You are a senior social media intelligence analyst at SIMElab Africa.
We are scanning a social media dataset for topics or accounts related to: "{base_keywords}".

Active Usernames in the dataset: {top_users_str}
Active Terms/Hashtags in the dataset: {top_terms_str}

Generate a JSON list of 10-20 specific keywords, handles, or hashtags to search for.
IMPORTANT:
1. Identify spelling corrections or matches from the Active Usernames/Terms for the user query.
   (e.g., "Liberty Shoes" → "liberty_stores" if in dataset; "Miato Technologies" → "MiatoTechnolo")
2. Decompose compound phrases into individual words.
3. Include Sheng/Swahili variations and commercial slang.

Return ONLY a JSON array, e.g. ["term1", "term2"]. No markdown."""

                expanded_res = self._call_llm(prompt_expand, api_key)
                if expanded_res and isinstance(expanded_res, list):
                    expanded_keywords = [k.strip() for k in expanded_res if k.strip()]

            # ── Build keyword groups: user_keyword → list of (pattern, term) ─
            stop_words = {
                "and", "their", "the", "a", "of", "to", "for", "in", "on", "at",
                "with", "is", "are", "it", "this", "that", "these", "those",
                "or", "but", "an", "by", "from", "up", "about", "into", "over", "after"
            }
            import difflib
            all_usernames: List[str] = []
            if has_source:
                all_usernames.extend(self.df["source"].dropna().astype(str).tolist())
            if has_target:
                all_usernames.extend(self.df["target"].dropna().astype(str).tolist())
            possibilities = list(set(all_usernames))
            pos_map = {p.lower(): p for p in possibilities}

            keyword_groups: Dict[str, list] = {ukw: [] for ukw in user_keywords}

            for ukw in user_keywords:
                terms = [ukw]

                # Spelling correction and prefix matching on the full query term
                clean_base = ukw.strip().lstrip("@#")
                if len(clean_base) >= 4:
                    cb_lower = clean_base.lower()
                    for username in possibilities:
                        u_lower = username.lower()
                        if u_lower.startswith(cb_lower) or cb_lower in u_lower:
                            terms.append(username)
                    close = difflib.get_close_matches(clean_base.lower(), pos_map.keys(), n=2, cutoff=0.75)
                    terms.extend([pos_map[c] for c in close])

                # Handle/hashtag decomposition + correction + prefix matching
                if ukw.startswith("@") or ukw.startswith("#"):
                    clean = ukw.lstrip("@#")
                    if len(clean) >= 3:
                        terms.append(clean)
                        cl_lower = clean.lower()
                        for username in possibilities:
                            u_lower = username.lower()
                            if u_lower.startswith(cl_lower) or cl_lower in u_lower:
                                terms.append(username)
                        close = difflib.get_close_matches(clean.lower(), pos_map.keys(), n=2, cutoff=0.75)
                        terms.extend([pos_map[c] for c in close])

                # Multi-word phrase decomposition + per-word correction + prefix matching
                words = [w.strip() for w in re.split(r"[^a-zA-Z0-9_]", ukw) if w.strip()]
                if len(words) > 1:
                    for w in words:
                        if len(w) >= 3 and w.lower() not in stop_words:
                            terms.append(w)
                            w_lower = w.lower()
                            for username in possibilities:
                                u_lower = username.lower()
                                if u_lower.startswith(w_lower) or (len(w_lower) >= 4 and w_lower in u_lower):
                                    terms.append(username)
                            close = difflib.get_close_matches(w.lower(), pos_map.keys(), n=2, cutoff=0.75)
                            terms.extend([pos_map[c] for c in close])

                # Deduplicate (preserve order, case-insensitive)
                seen: set = set()
                unique: List[str] = []
                for t in terms:
                    if t.lower() not in seen:
                        seen.add(t.lower())
                        unique.append(t)

                keyword_groups[ukw] = [(compile_keyword_pattern(t), t) for t in unique]

            # Associate LLM expansions back to nearest user keyword
            if expanded_keywords:
                for ekw in expanded_keywords:
                    ekw_lower = ekw.lower()
                    assigned = False
                    for ukw in user_keywords:
                        ukw_words = [
                            w.lower() for w in re.split(r"[^a-zA-Z0-9_]", ukw)
                            if len(w) >= 3 and w.lower() not in stop_words
                        ]
                        if any(w in ekw_lower for w in ukw_words) or any(ekw_lower in w for w in ukw_words):
                            keyword_groups[ukw].append((compile_keyword_pattern(ekw), ekw))
                            assigned = True
                            break
                    if not assigned:
                        gen = "Related / Auto-Expanded"
                        keyword_groups.setdefault(gen, [])
                        keyword_groups[gen].append((compile_keyword_pattern(ekw), ekw))

            compiled_patterns = keyword_groups
            category_counts = {k: 0 for k in compiled_patterns}
            expanded_keywords = list(set(user_keywords + expanded_keywords))
        else:
            # Default hardcoded category keywords
            for category, patterns in self.KEYWORDS.items():
                compiled_patterns[category] = [(re.compile(p, re.IGNORECASE), p) for p in patterns]
            category_counts = {k: 0 for k in self.KEYWORDS}

        # ── Phase 1: Full dataset scan ────────────────────────────────────────
        self.df["date_str"] = self.df["parsed_date"].dt.strftime("%Y-%m-%d")
        if self.df["date_str"].nunique() <= 2:
            self.df["date_str"] = self.df["parsed_date"].dt.strftime("%Y-%m-%d %H:00")

        trend_dict: Dict[str, dict] = {}
        commercial_df_idx: List[int] = []
        commercial_tweets: set = set()

        # Initialize hit counters
        term_hits: Dict[str, int] = {}
        for _, patterns in compiled_patterns.items():
            for _, term in patterns:
                term_hits[term] = 0

        # Context samples: term → list of descriptive strings (up to 6 per term)
        term_sample_contexts: Dict[str, List[str]] = {}

        # Track indices of rows matched per category
        category_matched_indices = {cat: set() for cat in compiled_patterns}

        # Track actual matched tweets for display (max 100 per category)
        category_matches = {cat: [] for cat in compiled_patterns}

        # Entity frequency: user_query → {entity_name: count}
        # Tracks which specific source/target accounts matched each user keyword
        keyword_entity_freq: Dict[str, Dict[str, int]] = {}
        if base_keywords:
            for ukw in user_keywords:
                keyword_entity_freq[ukw] = {}

        for idx, row in self.df.iterrows():
            text = str(row["tweet_text"])
            src = str(row["source"]) if (has_source and pd.notna(row["source"])) else ""
            tgt = str(row["target"]) if (has_target and pd.notna(row["target"])) else ""
            d_str = row["date_str"]

            if d_str not in trend_dict:
                trend_dict[d_str] = {"total": 0, "commercial": 0}
            trend_dict[d_str]["total"] += 1

            is_commercial = False
            for category, patterns in compiled_patterns.items():
                match_found = False
                for p, term in patterns:
                    m_text = bool(p.search(text))
                    m_src = bool(src and p.search(src))
                    m_tgt = bool(tgt and p.search(tgt))

                    if m_text or m_src or m_tgt:
                        term_hits[term] += 1
                        match_found = True

                        # ── Collect context sample (up to 6 per term) ────────
                        if len(term_sample_contexts.get(term, [])) < 6:
                            if m_src:
                                via = f"source={src}"
                            elif m_tgt:
                                via = f"target={tgt}"
                            else:
                                via = "tweet_text"
                            ctx = f"[via {via}, {src}→{tgt}]: {text[:110]}"
                            term_sample_contexts.setdefault(term, []).append(ctx)

                        # ── Track entity frequency for Phase 2 resolution ────
                        # Only relevant for custom keyword mode (not hardcoded KEYWORDS)
                        if base_keywords and category in keyword_entity_freq:
                            if m_src and src:
                                keyword_entity_freq[category][src] = (
                                    keyword_entity_freq[category].get(src, 0) + 1
                                )
                            if m_tgt and tgt:
                                keyword_entity_freq[category][tgt] = (
                                    keyword_entity_freq[category].get(tgt, 0) + 1
                                )

                if match_found:
                    category_counts[category] += 1
                    category_matched_indices[category].add(idx)
                    is_commercial = True

                    if len(category_matches[category]) < 100:
                        category_matches[category].append({
                            "text": text,
                            "source": src,
                            "target": tgt,
                            "date": row["parsed_date"].strftime("%Y-%m-%d %H:%M:%S") if hasattr(row["parsed_date"], "strftime") else str(row["parsed_date"]),
                        })

            if is_commercial:
                commercial_tweets.add(text)
                commercial_df_idx.append(idx)
                trend_dict[d_str]["commercial"] += 1

        total_commercial = len(commercial_tweets)
        percentage = (total_commercial / total_tweets) * 100 if total_tweets > 0 else 0

        sorted_trend = [
            {"date": k, "total": v["total"], "commercial": v["commercial"]}
            for k, v in sorted(trend_dict.items())
        ]

        # ── Phase 2: Intelligent entity resolution ───────────────────────────
        entity_resolutions: Dict[str, dict] = {}

        if base_keywords and user_keywords:
            for ukw in user_keywords:
                patterns_for_ukw = compiled_patterns.get(ukw, [])

                # Only resolve keywords that actually got at least one hit
                terms_with_hits = [
                    (term, term_hits.get(term, 0), term_sample_contexts.get(term, []))
                    for _, term in patterns_for_ukw
                    if term_hits.get(term, 0) > 0
                ]
                if not terms_with_hits:
                    continue

                entity_freq = keyword_entity_freq.get(ukw, {})

                # Step A: Offline frequency-based resolution (always runs)
                resolved = self._resolve_entity_offline(ukw, terms_with_hits, entity_freq)

                # Step B: LLM-powered contextual resolution (if API key provided)
                # The LLM sees HOW each matching term appeared in actual data rows
                # and determines what entity the user actually meant.
                if api_key:
                    contexts_for_llm = {
                        term: samples
                        for term, _, samples in terms_with_hits
                        if samples  # only pass terms with actual context strings
                    }
                    llm_resolved = self._resolve_entity_intent(
                        ukw, contexts_for_llm, entity_freq, api_key
                    )
                    if llm_resolved and isinstance(llm_resolved, dict):
                        # LLM result overrides offline values where non-None
                        for key, val in llm_resolved.items():
                            if val is not None:
                                resolved[key] = val

                # Step C: Second-pass search for the resolved entity to build the report
                resolved_entity = resolved.get("resolved_entity")
                if resolved_entity:
                    res_clean = resolved_entity.lstrip('@#').strip()
                    if res_clean:
                        p_res = re.compile(rf"(?<![a-zA-Z0-9]){re.escape(res_clean)}(?![a-zA-Z0-9])", re.IGNORECASE)
                        
                        # Find all rows matching the resolved entity across the entire dataset
                        res_indices = set()
                        res_contexts = []
                        for idx, row in self.df.iterrows():
                            text = str(row["tweet_text"])
                            src = str(row["source"]) if (has_source and pd.notna(row["source"])) else ""
                            tgt = str(row["target"]) if (has_target and pd.notna(row["target"])) else ""
                            
                            if (src.lower() == res_clean.lower()) or (tgt.lower() == res_clean.lower()) or p_res.search(text):
                                res_indices.add(idx)
                                if len(res_contexts) < 6:
                                    via = "source" if src.lower() == res_clean.lower() else ("target" if tgt.lower() == res_clean.lower() else "tweet_text")
                                    res_contexts.append(f"[via resolved {via}, {src}→{tgt}]: {text[:110]}")
                        
                        # Add resolved_entity to compiled_patterns[ukw] if not already present
                        if not any(term == resolved_entity for _, term in compiled_patterns[ukw]):
                            compiled_patterns[ukw].append((p_res, resolved_entity))
                        
                        # Update term hits & contexts
                        term_hits[resolved_entity] = len(res_indices)
                        term_sample_contexts[resolved_entity] = res_contexts
                        
                        # Update category matched indices and counts
                        first_pass_indices = category_matched_indices.get(ukw, set())
                        new_matches = res_indices - first_pass_indices
                        
                        for idx in new_matches:
                            category_matched_indices[ukw].add(idx)
                            row = self.df.loc[idx]
                            text = str(row["tweet_text"])
                            d_str = row["date_str"]
                            src = str(row["source"]) if (has_source and pd.notna(row["source"])) else ""
                            tgt = str(row["target"]) if (has_target and pd.notna(row["target"])) else ""
                            
                            if idx not in commercial_df_idx:
                                commercial_df_idx.append(idx)
                                commercial_tweets.add(text)
                                if d_str in trend_dict:
                                    trend_dict[d_str]["commercial"] += 1
                            
                            if len(category_matches[ukw]) < 100:
                                category_matches[ukw].append({
                                    "text": text,
                                    "source": src,
                                    "target": tgt,
                                    "date": row["parsed_date"].strftime("%Y-%m-%d %H:%M:%S") if hasattr(row["parsed_date"], "strftime") else str(row["parsed_date"]),
                                })
                        
                        category_counts[ukw] = len(category_matched_indices[ukw])
                        resolved["total_hits"] = len(category_matched_indices[ukw])

                entity_resolutions[ukw] = resolved

        # ── Build enriched keyword_mappings ──────────────────────────────────
        keyword_mappings: Dict[str, dict] = {}
        for category, patterns in compiled_patterns.items():
            terms_list = sorted(
                [{"term": term, "hits": term_hits.get(term, 0)} for _, term in patterns],
                key=lambda x: x["hits"],
                reverse=True,
            )
            resolution = entity_resolutions.get(category, {})
            # total_hits from resolution is the authoritative count (de-duped per row);
            # fallback to sum of term hits (may double-count if multiple terms match same row)
            total_kw_hits = resolution.get("total_hits") or sum(t["hits"] for t in terms_list)

            keyword_mappings[category] = {
                "original_query": category,
                "terms": terms_list,
                "total_hits": total_kw_hits,
                "sample_hits": category_matches.get(category, []),
                # Resolution fields (present only when base_keywords is set and hits found)
                "resolved_entity": resolution.get("resolved_entity"),
                "resolved_entity_type": resolution.get("resolved_entity_type"),
                "intent_summary": resolution.get("intent_summary"),
                "confidence": resolution.get("confidence"),
                "reasoning": resolution.get("reasoning"),
            }

        # ── LLM co-optation insights ─────────────────────────────────────────
        ai_insights = None
        if api_key and commercial_df_idx:
            comm_df = self.df.loc[commercial_df_idx]
            sample = comm_df.sample(min(sample_size, len(comm_df)), random_state=42)
            sample_text = "\n".join(f"- {t}" for t in sample["tweet_text"])

            prompt = f"""You are a senior social media intelligence analyst at SIMElab Africa.
We have identified tweets from a political or social campaign containing commercial/product keywords,
indicating potential co-optation by sellers/spammers.

Sample of commercial tweets:
{sample_text}

Provide an expert analysis on how commercial entities or spammers are co-opting the hashtag/campaign.
Are these genuine small businesses (hustlers) taking advantage of trending hashtags, or are there
bot-like spam networks? What are the most common selling strategies or code-switching (Sheng/Swahili)
tactics used here?

Return ONLY a JSON object with this exact structure:
{{
  "commercial_cooptation_level": <float between 0.0 and 1.0 (1.0 = heavy spam/hijacking)>,
  "main_tactics": [<list of 3-5 strategies used to sell within the trend>],
  "bot_vs_genuine": "<analysis of whether it looks like bots or genuine small businesses>",
  "analysis_text": "<detailed analytical brief summarizing the commercial hijacking trends and slang>"
}}
Return ONLY the JSON without markdown formatting."""

            ai_insights = self._call_llm(prompt, api_key)

        return {
            "total_tweets": total_tweets,
            "commercial_tweets": total_commercial,
            "percentage_commercial": percentage,
            "category_counts": category_counts,
            "trend": sorted_trend,
            "ai_analysis": ai_insights,
            "expanded_keywords": expanded_keywords,
            "keyword_mappings": keyword_mappings,
            "debug_info": {
                "source_column": getattr(self, "src_col_name", None),
                "target_column": getattr(self, "tgt_col_name", None),
                "date_column": getattr(self, "date_col_name", None),
                "text_column": getattr(self, "text_col_name", None),
                "total_rows_loaded": total_tweets,
                "active_usernames_count": len(possibilities) if 'possibilities' in locals() else 0,
            }
        }

    def _call_llm(self, prompt: str, api_key: str) -> Optional[Any]:
        try:
            tr_env_key = read_env_key("TOKENROUTER_API_KEY")
            nv_env_key = read_env_key("NVIDIA_API_KEY")
            ds_env_key = read_env_key("DEEPSEEK_API_KEY")

            is_tokenrouter = api_key.startswith("tr-") or tr_env_key != ""
            is_nvidia = api_key.startswith("nvapi-") or nv_env_key != ""

            if is_tokenrouter:
                url = read_env_key("TOKENROUTER_API_URL", "https://api.tokenrouter.com/v1/chat/completions")
                model = read_env_key("TOKENROUTER_MODEL", "MiniMax-M3")
                auth_key = api_key if api_key.startswith("tr-") else (tr_env_key or api_key)
            elif is_nvidia:
                url = read_env_key("NVIDIA_API_URL", "https://integrate.api.nvidia.com/v1/chat/completions")
                model = read_env_key("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct")
                auth_key = api_key if api_key.startswith("nvapi-") else (nv_env_key or api_key)
            else:
                url = "https://api.deepseek.com/v1/chat/completions"
                model = "deepseek-chat"
                auth_key = api_key or ds_env_key

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {auth_key}",
            }
            body = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 4000,
                "stream": False,
            }

            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=60) as response:
                res_body = response.read().decode("utf-8")
                res_data = json.loads(res_body)
                content = res_data["choices"][0]["message"]["content"].strip()

                # Strip chain-of-thought blocks
                if "</think>" in content:
                    content = content.split("</think>")[-1].strip()
                elif "<think>" in content:
                    think_end = content.find(">", content.rfind("<think>"))
                    if think_end != -1:
                        content = content[think_end + 1:].strip()

                # Try to extract JSON object {...}
                start = content.find('{')
                end = content.rfind('}')
                if start != -1 and end != -1 and end > start:
                    content = content[start:end+1]

                return json.loads(content)
        except Exception as e:
            print(f"Commercial LLM analysis failed: {e}")
            return None
