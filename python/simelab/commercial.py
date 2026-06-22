"""
commercial.py — Commercial intent and co-optation analysis.

Analyzes tweets for specific product/service keywords (e.g., Furniture, Computers, Betting)
and computes commercial percentages, trends, and optionally uses the LLM API to
analyze narrative co-optation strategies.
"""

import json
import urllib.request
import urllib.error
import re
from pathlib import Path
from typing import Dict, Any, Optional
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

class CommercialAnalyzer:
    """
    Analyzes commercial content in a dataset by searching for specific product and
    service keywords, computing frequencies, extracting trends, and requesting LLM insights.
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

        date_col = next((col for col in ("Date", "Relationship Date (UTC)", "date", "timestamp", "created_at") if col in df.columns), None)
        text_col = next((col for col in ("Tweet", "tweet", "text", "content", "Tooltip", "Label") if col in df.columns), None)

        if not text_col:
            raise ValueError("No tweet text column found in the dataset.")

        df = df.dropna(subset=[text_col])
        df[text_col] = df[text_col].astype(str).str.strip()

        if date_col:
            df["parsed_date"] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.dropna(subset=["parsed_date"])
            df = df.sort_values("parsed_date")
        else:
            df["parsed_date"] = pd.to_datetime("now")

        self.df = df[[text_col, "parsed_date"]].rename(columns={text_col: "tweet_text"})
        self.df = self.df.drop_duplicates(subset=["tweet_text"])
        return self.df

    def analyze(self, api_key: str = "", base_keywords: str = "", sample_size: int = 50) -> Dict[str, Any]:
        self._load_tweets()
        if self.df is None or self.df.empty:
            raise ValueError("No tweets found for analysis.")

        total_tweets = len(self.df)

        user_keywords = [k.strip() for k in base_keywords.split(",") if k.strip()]
        expanded_keywords = []
        compiled_patterns = {}
        category_counts = {}

        if base_keywords:
            if api_key:
                # Dynamically expand keywords
                prompt_expand = f"""
You are a social media analyst working with Kenyan/East African social media data.
We need to scan tweets for topics related to the following user input: "{base_keywords}".
Please provide a JSON list of 10-20 specific keywords, including variations, local slang (e.g. Sheng/Swahili if applicable), and related products/services.
Return ONLY a JSON array of strings, e.g. ["keyword1", "keyword2", ...]. No markdown, no explanations.
"""
                expanded_res = self._call_llm(prompt_expand, api_key)
                if expanded_res and isinstance(expanded_res, list):
                    expanded_keywords = expanded_res
            
            # Combine user keywords and expanded keywords
            all_keywords = list(set(user_keywords + expanded_keywords))
            
            # Use dynamic keywords
            compiled_patterns["Dynamic Keywords"] = [re.compile(rf"\b{re.escape(k)}\b", re.IGNORECASE) for k in all_keywords]
            category_counts = {"Dynamic Keywords": 0}
            expanded_keywords = all_keywords
        else:
            # Default to hardcoded categories
            for category, patterns in self.KEYWORDS.items():
                compiled_patterns[category] = [re.compile(p, re.IGNORECASE) for p in patterns]
            category_counts = {k: 0 for k in self.KEYWORDS.keys()}

        commercial_tweets = set()

        # Build trend data: group by day (or hour if few days)
        self.df["date_str"] = self.df["parsed_date"].dt.strftime("%Y-%m-%d")
        # Try hour if everything is same day
        if self.df["date_str"].nunique() <= 2:
            self.df["date_str"] = self.df["parsed_date"].dt.strftime("%Y-%m-%d %H:00")

        trend_dict = {}

        commercial_df_idx = []

        for idx, row in self.df.iterrows():
            text = row["tweet_text"]
            d_str = row["date_str"]
            if d_str not in trend_dict:
                trend_dict[d_str] = {"total": 0, "commercial": 0}
            trend_dict[d_str]["total"] += 1

            is_commercial = False
            for category, patterns in compiled_patterns.items():
                if any(p.search(text) for p in patterns):
                    category_counts[category] += 1
                    is_commercial = True
            
            if is_commercial:
                commercial_tweets.add(text)
                commercial_df_idx.append(idx)
                trend_dict[d_str]["commercial"] += 1

        total_commercial = len(commercial_tweets)
        percentage = (total_commercial / total_tweets) * 100 if total_tweets > 0 else 0

        # Sort trend data
        sorted_trend = [{"date": k, "total": v["total"], "commercial": v["commercial"]} 
                        for k, v in sorted(trend_dict.items())]

        # Call LLM for insights if key provided
        ai_insights = None
        if api_key and commercial_df_idx:
            # Sample commercial tweets
            comm_df = self.df.loc[commercial_df_idx]
            sample = comm_df.sample(min(sample_size, len(comm_df)), random_state=42)
            sample_text = "\n".join(f"- {t}" for t in sample["tweet_text"])
            
            prompt = f"""
You are a senior social media intelligence analyst at SIMElab Africa.
We have identified tweets from a political or social campaign that contain commercial/product keywords (Furniture, Clothing, Betting, Tech, etc.), indicating potential co-optation by sellers/spammers.

Sample of commercial tweets:
{sample_text}

Provide an expert analysis on how commercial entities or spammers are co-opting the hashtag/campaign.
Are these genuine small businesses (hustlers) taking advantage of trending hashtags, or are there bot-like spam networks? What are the most common selling strategies or code-switching (Sheng/Swahili) tactics used here?

Return ONLY a JSON object with this exact structure:
{{
  "commercial_cooptation_level": <float between 0.0 and 1.0 (1.0 = heavy spam/hijacking)>,
  "main_tactics": [<list of 3-5 strategies used to sell within the trend>],
  "bot_vs_genuine": "<analysis of whether it looks like bots or genuine small businesses>",
  "analysis_text": "<detailed analytical brief summarizing the commercial hijacking trends and slang>"
}}
Return ONLY the JSON without markdown formatting.
"""
            ai_insights = self._call_llm(prompt, api_key)

        return {
            "total_tweets": total_tweets,
            "commercial_tweets": total_commercial,
            "percentage_commercial": percentage,
            "category_counts": category_counts,
            "trend": sorted_trend,
            "ai_analysis": ai_insights,
            "expanded_keywords": expanded_keywords
        }

    def _call_llm(self, prompt: str, api_key: str) -> Optional[Dict[str, Any]]:
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

                if "</think>" in content:
                    content = content.split("</think>")[-1].strip()
                elif "<think>" in content:
                    think_end = content.find(">", content.rfind("<think>"))
                    if think_end != -1:
                        content = content[think_end + 1:].strip()

                start = content.find('{')
                end = content.rfind('}')
                if start != -1 and end != -1 and end > start:
                    content = content[start:end+1]

                return json.loads(content)
        except Exception as e:
            print(f"Commercial LLM analysis failed: {e}")
            return None
