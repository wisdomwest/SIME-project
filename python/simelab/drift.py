"""
drift.py — Semantic drift and co-optation analysis using the LLM API.

Divides tweet texts into Early and Late chronological halves, samples them,
and queries LLM to detect semantic shifts, Swahili/Sheng slang features,
and narrative hijacking.
"""

import json
import urllib.request
import urllib.error
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


class SemanticDriftAnalyzer:
    """
    Analyze semantic shifts and narrative co-optation in a tweet dataset.
    Queries LLM to examine language features (Sheng/Swahili)
    and compute a narrative drift score.
    """

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.df: Optional[pd.DataFrame] = None

    def _load_tweets(self) -> pd.DataFrame:
        """Load and clean edges sheet to extract date and text columns."""
        filepath = Path(self.filepath)
        if not filepath.exists():
            raise FileNotFoundError(f"File not found: {self.filepath}")

        # Try to read Excel or CSV
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

        # Identify date column
        date_col = None
        for col in ("Date", "Relationship Date (UTC)", "date", "timestamp", "created_at"):
            if col in df.columns:
                date_col = col
                break

        # Identify text column
        text_col = None
        for col in ("Tweet", "tweet", "text", "content", "Tooltip", "Label"):
            if col in df.columns:
                text_col = col
                break

        if not text_col:
            raise ValueError("No tweet text column found in the dataset.")

        # Clean dataframe
        df = df.dropna(subset=[text_col])
        df[text_col] = df[text_col].astype(str).str.strip()

        # Parse date if available
        if date_col:
            df["parsed_date"] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.dropna(subset=["parsed_date"])
            df = df.sort_values("parsed_date")
        else:
            # Fallback to row order
            df["parsed_date"] = range(len(df))

        self.df = df[[text_col, "parsed_date"]].rename(columns={text_col: "tweet_text"})
        
        # De-duplicate to analyze unique statements in the campaign context
        self.df = self.df.drop_duplicates(subset=["tweet_text"])
        return self.df

    def analyze(self, api_key: str, sample_size: int = 1500) -> Dict[str, Any]:
        """
        Run the semantic drift analysis.
        Divides tweets chronologically, samples, and queries LLM.
        """
        self._load_tweets()
        if self.df is None or self.df.empty:
            raise ValueError("No tweets found for analysis.")

        total_tweets = len(self.df)

        # Divide into Early and Late halves
        midpoint = total_tweets // 2
        early_df = self.df.iloc[:midpoint]
        late_df = self.df.iloc[midpoint:]

        current_sample_size = sample_size
        last_error = None

        # Try up to 2 times. If the first fails/times out, we retry with a smaller sample size (half)
        for attempt in range(2):
            try:
                # Chronologically sort/keep subsets to maintain timeline flow for LLM analysis
                if len(early_df) <= current_sample_size:
                    early_sample = early_df
                else:
                    early_sample = early_df.sample(current_sample_size, random_state=42 + attempt).sort_values("parsed_date")

                if len(late_df) <= current_sample_size:
                    late_sample = late_df
                else:
                    late_sample = late_df.sample(current_sample_size, random_state=42 + attempt).sort_values("parsed_date")

                # Concatenate samples into formatted strings
                early_text = "\n".join(f"- {row['tweet_text']}" for _, row in early_sample.iterrows())
                late_text = "\n".join(f"- {row['tweet_text']}" for _, row in late_sample.iterrows())

                # Construct prompt
                prompt = f"""
You are a senior social media intelligence analyst at SIMElab Africa (USIU-Africa, Nairobi).
Analyze these two sets of tweets from a campaign (which may contain English, Swahili, and Sheng code-switching) to detect semantic drift and co-optation.

Early Tweets (Campaign Origin / Growth):
{early_text}

Late Tweets (Campaign Evolution / Peak):
{late_text}

Provide an expert analysis of the narrative evolution.
Sheng is a Kenyan urban slang (combining Swahili, English, and local languages). Swahili is also widely used. Scan for code-switching.
Detect if the campaign shifted from its original topic (e.g. grassroots tax protests) to a different narrative (e.g. politician scandals, coordinated deflection, or propaganda).

Return ONLY a JSON object with this exact structure:
{{
  "drift_score": <float between 0.0 and 1.0 representing how much the topics and narrative shifted>,
  "is_coopted": <true or false: did opposing or manipulative actors hijack the narrative>,
  "early_topics": [<list of 3-5 main topics in the early tweets>],
  "late_topics": [<list of 3-5 main topics in the late tweets>],
  "analysis_text": "<detailed analytical brief summarizing narrative evolution, linguistic features like Swahili/Sheng code-switching, and evidence of co-optation>",
  "swahili_sheng_count": <approximate number of tweets in the entire provided sample that contain Swahili or Sheng>
}}
Return ONLY the JSON. Do not include markdown code blocks, do not write '```json', and do not append extra text.
"""

                # Call LLM API (TokenRouter / NVIDIA NIM / DeepSeek) using standard urllib
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
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 10000,
                    "stream": False,
                }

                req = urllib.request.Request(
                    url,
                    data=json.dumps(body).encode("utf-8"),
                    headers=headers,
                    method="POST"
                )

                with urllib.request.urlopen(req, timeout=120) as response:
                    res_body = response.read().decode("utf-8")
                    res_data = json.loads(res_body)
                    choice = res_data["choices"][0]
                    finish_reason = choice.get("finish_reason", "")
                    content = choice["message"]["content"].strip()

                    # Detect truncation: model hit token limit before finishing JSON
                    if finish_reason == "length":
                        raise ValueError(
                            "LLM response was truncated (finish_reason=length). "
                            "The model ran out of tokens before completing the JSON."
                        )
                    
                    # Strip <think>...</think> blocks from deep-thinking LLMs.
                    if "</think>" in content:
                        content = content.split("</think>")[-1].strip()
                    elif "<think>" in content:
                        # Find the end of the opening tag itself
                        think_end = content.find(">", content.rfind("<think>"))
                        if think_end != -1:
                            content = content[think_end + 1:].strip()

                    # Guard: if content is empty after stripping, raise a useful error
                    if not content:
                        raise ValueError("LLM returned an empty content string after stripping think-tags.")

                    # Robustly extract JSON block from content
                    start = content.find('{')
                    end = content.rfind('}')
                    if start != -1 and end != -1 and end > start:
                        json_str = content[start:end+1]
                    else:
                        json_str = content

                    parsed_result = json.loads(json_str)
                    parsed_result["sample_size"] = len(early_sample) + len(late_sample)
                    parsed_result["total_tweets"] = total_tweets
                    return parsed_result

            except urllib.error.HTTPError as e:
                last_error = e
                err_body = ""
                try:
                    err_body = e.read().decode("utf-8")
                except Exception:
                    pass
                # Cache the read body so it can be accessed again without re-reading the drained stream
                e.cached_body = err_body
                
                is_context_error = False
                if e.code in (400, 413):
                    if any(word in err_body.lower() for word in ("context", "token", "length", "too large", "limit")):
                        is_context_error = True
                
                if is_context_error:
                    current_sample_size = max(10, current_sample_size // 2)
                    print(f"Semantic drift analysis attempt {attempt + 1} failed due to context length. Retrying with sample size {current_sample_size}...")
                else:
                    # Other HTTP errors (401, 403, etc.) represent credential/system errors; raise immediately
                    break
            except Exception as e:
                last_error = e
                # For network timeouts or connection resets, reduce sample size and retry
                current_sample_size = max(10, current_sample_size // 2)
                print(f"Semantic drift analysis attempt {attempt + 1} failed: {str(e)}. Retrying with sample size {current_sample_size}...")

        # If we reached here, raise the last error
        if isinstance(last_error, urllib.error.HTTPError):
            err_msg = getattr(last_error, "cached_body", "")
            if not err_msg:
                try:
                    err_msg = last_error.read().decode("utf-8")
                except Exception:
                    err_msg = "Unknown HTTP error"
            try:
                err_data = json.loads(err_msg)
                detail = err_data.get("error", {}).get("message", err_msg)
            except Exception:
                detail = err_msg
            raise ValueError(f"LLM API error ({last_error.code}): {detail}")
        else:
            raise ValueError(f"Failed to query LLM API: {str(last_error)}")
