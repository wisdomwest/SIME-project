import asyncio
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PYTHON_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_ROOT))

import server  # noqa: E402
from simelab import redis_cache  # noqa: E402
from simelab.censorship import CensorshipAnalyzer  # noqa: E402
from simelab.drift import SemanticDriftAnalyzer  # noqa: E402


class _FakeRedis:
    def __init__(self):
        self.values = {}
        self.scores = {}

    def pipeline(self, transaction=True):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def set(self, key, value, ex=None):
        self.values[key] = value
        return self

    def get(self, key):
        return self.values.get(key)

    def zadd(self, key, mapping):
        self.scores.update(mapping)
        return self

    def expire(self, key, seconds):
        return self

    def execute(self):
        return []

    def zremrangebyscore(self, key, minimum, maximum):
        cutoff = float(maximum)
        self.scores = {name: score for name, score in self.scores.items() if score > cutoff}

    def zrevrangebyscore(self, key, maximum, minimum):
        floor = float(minimum)
        return [name.encode() for name, score in self.scores.items() if score >= floor]

    def exists(self, key):
        return key in self.values

    def zrem(self, key, name):
        self.scores.pop(name, None)

    def ping(self):
        return True


class RedisCacheRegressionTests(unittest.TestCase):
    def setUp(self):
        server.analyses.clear()
        redis_cache._load_payload.cache_clear()

    def test_compressed_json_round_trip(self):
        fake = _FakeRedis()
        original = redis_cache._client
        redis_cache._client = fake
        try:
            meta = {"filename": "sample.csv", "graph_stats": {"node_count": 2}}
            analysis = {"vertices": [{"id": "a"}, {"id": "b"}], "edges": []}
            self.assertTrue(redis_cache.save_full_analysis("sample", meta, analysis))
            restored = redis_cache.load_full_analysis("sample")
            self.assertEqual(restored["meta"]["filename"], "sample.csv")
            self.assertEqual(len(restored["analysis"]["vertices"]), 2)
            self.assertEqual(redis_cache.list_datasets(), [{"id": "sample"}])
        finally:
            redis_cache._client = original
            redis_cache._load_payload.cache_clear()

    def test_full_analysis_restores_from_redis_payload(self):
        fake = _FakeRedis()
        original = redis_cache._client
        redis_cache._client = fake
        fixture = Path(__file__).parent / "fixtures" / "small_network.csv"
        try:
            computed = server._run_full_analysis(str(fixture), "small-network")
            server.analyses.clear()
            restored = server._load_analysis_from_cache("small-network")
            self.assertIsNotNone(restored)
            self.assertEqual(restored["G"].number_of_nodes(), computed["G"].number_of_nodes())
            self.assertEqual(restored["G"].number_of_edges(), computed["G"].number_of_edges())
            self.assertAlmostEqual(restored["sa"].silhouette, computed["sa"].silhouette)
            for node, attrs in restored["G"].nodes(data=True):
                self.assertIsInstance(attrs["betweenness"], (int, float))
                self.assertIsInstance(attrs["degree"], (int, float))
                self.assertEqual(attrs["sentiment"], restored["sa"].labels[node])

            overview = asyncio.run(server.get_analysis_data("small-network"))
            self.assertEqual(
                overview["metrics"]["sentimentDistribution"],
                restored["sa"].cluster_sizes,
            )
            self.assertNotEqual(
                overview["metrics"]["sentimentDistribution"]["Neu"],
                restored["G"].number_of_nodes(),
            )

            context = server._analysis_metric_context(restored)
            self.assertIn("Whole network:", context)
            self.assertIn("Giant component:", context)
            self.assertIn("Sentiment clusters:", context)

            captured = {}

            class FakeDriftAnalyzer:
                def __init__(self, filepath):
                    captured["filepath"] = filepath

                def analyze(self, api_key, network_context):
                    captured["api_key"] = api_key
                    captured["network_context"] = network_context
                    return {"drift_score": 0.25, "is_coopted": False}

            async def inline_to_thread(function, *args, **kwargs):
                return function(*args, **kwargs)

            with (
                patch.object(server, "_get_analysis", return_value=restored),
                patch.object(server, "_llm_settings", return_value=("nvidia-nim", "test-key", "model", "url")),
                patch.object(server, "SemanticDriftAnalyzer", FakeDriftAnalyzer),
                patch.object(server.asyncio, "to_thread", new=inline_to_thread),
            ):
                drift = asyncio.run(server.get_semantic_drift("small-network"))
            self.assertEqual(drift["drift_score"], 0.25)
            self.assertIn("Giant component:", captured["network_context"])
        finally:
            server.analyses.clear()
            redis_cache._client = original
            redis_cache._load_payload.cache_clear()

    def test_identical_uploads_always_recompute(self):
        class MemoryUpload:
            filename = "same.csv"

            def __init__(self):
                self._file = io.BytesIO(b"source,target\na,b\n")

            async def read(self, size):
                return self._file.read(size)

            async def close(self):
                self._file.close()

        async def exercise():
            async def inline_to_thread(function, *args, **kwargs):
                return function(*args, **kwargs)

            with tempfile.TemporaryDirectory() as directory:
                with (
                    patch.object(server, "UPLOADS_DIR", Path(directory)),
                    patch.object(server, "_run_full_analysis", return_value={"fresh": True}) as run,
                    patch.object(server, "_build_analysis_summary", return_value="summary"),
                    patch.object(server.asyncio, "to_thread", new=inline_to_thread),
                ):
                    for _ in range(2):
                        upload = MemoryUpload()
                        self.assertEqual(await server.upload_file(upload), "summary")
                    self.assertEqual(run.call_count, 2)

        asyncio.run(exercise())

    def test_censorship_reuses_feature_betweenness(self):
        import networkx as nx

        graph = nx.DiGraph([("a", "b"), ("b", "c")])
        supplied = {"a": 0.1, "b": 0.8, "c": 0.1}
        with patch("simelab.censorship.nx.betweenness_centrality", side_effect=AssertionError):
            analyzer = CensorshipAnalyzer(graph, betweenness=supplied)
        self.assertIs(analyzer.betweenness, supplied)

    def test_disconnected_censorship_uses_consistent_component_metrics(self):
        import networkx as nx

        graph = nx.DiGraph([
            ("a", "b"), ("b", "c"), ("c", "a"),
            ("x", "y"), ("y", "z"), ("z", "x"),
        ])
        betweenness = nx.betweenness_centrality(graph, normalized=True)
        analyzer = CensorshipAnalyzer(graph, betweenness=betweenness)
        analyzer.find_structural_holes(k=3)
        self.assertIsNone(analyzer.censorship_vulnerability_index())
        self.assertEqual(analyzer.fiedler_value, 0.0)
        self.assertEqual(analyzer.component_count, 2)
        self.assertEqual(analyzer.largest_component_nodes, 3)
        self.assertAlmostEqual(analyzer.largest_component_share, 0.5)
        self.assertGreater(analyzer.largest_component_fiedler, 0.0)
        self.assertIsNotNone(analyzer.component_cvi)


class SecurityBoundaryTests(unittest.TestCase):
    def test_llm_config_never_returns_a_key(self):
        config = asyncio.run(server.get_llm_config())
        self.assertNotIn("apiKey", config)
        self.assertNotIn("key", config)
        self.assertIn("configured", config)

    def test_chat_forwards_analysis_context_to_provider(self):
        captured = {}

        def fake_call(question, context):
            captured["question"] = question
            captured["context"] = context
            return "verified response"

        async def inline_to_thread(function, *args, **kwargs):
            return function(*args, **kwargs)

        request = server.LLMChatRequest(
            user_question="Interpret connectivity",
            context="148 components; giant Fiedler 0.0278; component CVI 0.005876",
        )
        with (
            patch.object(server, "_call_llm", side_effect=fake_call),
            patch.object(server.asyncio, "to_thread", new=inline_to_thread),
        ):
            response = asyncio.run(server.llm_chat(request))
        self.assertEqual(response["content"], "verified response")
        self.assertIn("giant Fiedler 0.0278", captured["context"])

    def test_drift_prompt_contains_persisted_network_context(self):
        captured = {}
        fixture = Path(__file__).parent / "fixtures" / "small_network.csv"

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                content = {
                    "drift_score": 0.3,
                    "is_coopted": False,
                    "early_topics": ["origin"],
                    "late_topics": ["evolution"],
                    "analysis_text": "Verified",
                    "swahili_sheng_count": 0,
                }
                return server.json.dumps({
                    "choices": [{
                        "finish_reason": "stop",
                        "message": {"content": server.json.dumps(content)},
                    }]
                }).encode()

        def fake_urlopen(request, timeout):
            captured["prompt"] = server.json.loads(request.data)["messages"][0]["content"]
            captured["timeout"] = timeout
            return FakeResponse()

        analyzer = SemanticDriftAnalyzer(str(fixture))
        with patch("simelab.drift.urllib.request.urlopen", side_effect=fake_urlopen):
            result = analyzer.analyze(
                api_key="nvapi-test",
                sample_size=2,
                network_context="148 components; giant Fiedler 0.02781851",
            )
        self.assertEqual(result["drift_score"], 0.3)
        self.assertIn("148 components; giant Fiedler 0.02781851", captured["prompt"])

    def test_image_route_is_allowlisted(self):
        image = server._resolve_public_image("RejectFinanceBill2024/Img-chriskhaim.png")
        self.assertTrue(image.is_file())
        with self.assertRaises(server.HTTPException):
            server._resolve_public_image("SIME-project/python/server.py")
        with self.assertRaises(server.HTTPException):
            server._resolve_public_image("../.env")

    def test_download_requires_registered_token_and_exact_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            export = Path(directory) / "metrics.csv"
            export.write_text("id,degree\n", encoding="utf-8")
            token = "test-token"
            server.exports_registry[token] = {
                "files": {"metrics": str(export)},
                "created": server.time.time(),
            }
            response = asyncio.run(server.download_file(token, export.name))
            self.assertEqual(Path(response.path), export)
            with self.assertRaises(server.HTTPException):
                asyncio.run(server.download_file(token, "server.py"))
            server.exports_registry.pop(token, None)


if __name__ == "__main__":
    unittest.main()
