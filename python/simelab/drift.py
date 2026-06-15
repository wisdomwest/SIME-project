"""
drift.py — Semantic drift and co-optation analysis using the DeepSeek API.

Divides tweet texts into Early and Late chronological halves, samples them,
and queries DeepSeek to detect semantic shifts, Swahili/Sheng slang features,
and narrative hijacking.
"""

import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any, Optional
import pandas as pd


class SemanticDriftAnalyzer:
    """
    Analyze semantic shifts and narrative co-optation in a tweet dataset.
    Queries the DeepSeek API to examine language features (Sheng/Swahili)
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
        return self.df

    def analyze(self, api_key: str, sample_size: int = 40) -> Dict[str, Any]:
        """
        Run the semantic drift analysis.
        Divides tweets chronologically, samples, and queries DeepSeek.
        """
        self._load_tweets()
        if self.df is None or self.df.empty:
            raise ValueError("No tweets found for analysis.")

        total_tweets = len(self.df)

        # Divide into Early and Late halves
        midpoint = total_tweets // 2
        early_df = self.df.iloc[:midpoint]
        late_df = self.df.iloc[midpoint:]

        # Sample from each half to stay within token limits
        early_sample = early_df.sample(min(sample_size, len(early_df)), random_state=42)
        late_sample = late_df.sample(min(sample_size, len(late_df)), random_state=42)

        # Concatenate samples into formatted strings
        early_text = "\n".join(f"- {row['tweet_text']}" for _, row in early_sample.iterrows())
        late_text = "\n".join(f"- {row['tweet_text']}" for _, row in late_sample.iterrows())

        # Construct prompt
        prompt = f"""
You are a senior social media intelligence analyst at SIMElab Africa (USIU-Africa, Nairobi).
Analyze these two sets of sampled tweets from a campaign (which may contain English, Swahili, and Sheng code-switching) to detect semantic drift and co-optation.

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

        # Call LLM API (DeepSeek or NVIDIA NIM) using standard urllib
        import os
        is_nvidia = api_key.startswith("nvapi-") or "NVIDIA_API_KEY" in os.environ

        if is_nvidia:
            url = os.environ.get("NVIDIA_API_URL", "https://integrate.api.nvidia.com/v1/chat/completions")
            model = os.environ.get("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct")
            auth_key = api_key if api_key.startswith("nvapi-") else os.environ.get("NVIDIA_API_KEY")
        else:
            url = "https://api.deepseek.com/v1/chat/completions"
            model = "deepseek-chat"
            auth_key = api_key

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
            "max_tokens": 1500,
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                res_body = response.read().decode("utf-8")
                res_data = json.loads(res_body)
                content = res_data["choices"][0]["message"]["content"].strip()
                
                # Strip markdown code blocks if the model ignored instructions
                if content.startswith("```"):
                    content = content.split("```")[1]
                    if content.startswith("json"):
                        content = content[4:]
                    content = content.strip()

                parsed_result = json.loads(content)
                parsed_result["sample_size"] = len(early_sample) + len(late_sample)
                parsed_result["total_tweets"] = total_tweets
                return parsed_result

        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8")
            try:
                err_data = json.loads(err_msg)
                detail = err_data.get("error", {}).get("message", err_msg)
            except Exception:
                detail = err_msg
            raise ValueError(f"LLM API error ({e.code}): {detail}")
        except Exception as e:
            raise ValueError(f"Failed to query LLM API: {str(e)}")
