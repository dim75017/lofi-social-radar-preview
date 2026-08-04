from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COLLECTOR_PATH = ROOT / "scripts" / "collect_public_history.py"


def load_collector():
    if not (ROOT / "work" / "ytdeps").is_dir():
        raise unittest.SkipTest("yt-dlp local absent; tests du collecteur ignorés")
    yt_dlp = types.ModuleType("yt_dlp")
    yt_dlp.YoutubeDL = object
    yt_dlp.version = types.SimpleNamespace(__version__="test")
    extractor = types.ModuleType("yt_dlp.extractor")
    youtube = types.ModuleType("yt_dlp.extractor.youtube")
    youtube.YoutubeTabIE = object
    utils = types.ModuleType("yt_dlp.utils")
    utils.parse_count = lambda value: None
    sys.modules.update(
        {
            "yt_dlp": yt_dlp,
            "yt_dlp.extractor": extractor,
            "yt_dlp.extractor.youtube": youtube,
            "yt_dlp.utils": utils,
        }
    )
    spec = importlib.util.spec_from_file_location("collect_public_history", COLLECTOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("impossible de charger le collecteur")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CollectorAppendOnlyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.collector = load_collector()

    def test_partial_collection_preserves_other_platforms_and_coverage(self):
        existing = {
            "coverage": [
                {
                    "platform": "youtube",
                    "accountUrl": "https://www.youtube.com/@LofiGirl",
                    "itemCount": 1,
                },
                {
                    "platform": "tiktok",
                    "accountUrl": "https://www.tiktok.com/@lofigirl",
                    "itemCount": 1,
                },
            ],
            "posts": [
                {"platform": "youtube", "externalId": "yt", "raw": {}},
                {"platform": "tiktok", "externalId": "tt", "raw": {}},
            ],
        }

        posts = self.collector.load_existing_posts(existing)
        coverage = self.collector.merge_coverage_with_existing(
            [{"platform": "youtube", "itemCount": 2}],
            existing,
            {"youtube"},
            preserve_unselected=True,
        )

        self.assertEqual({post["platform"] for post in posts}, {"youtube", "tiktok"})
        self.assertEqual(
            {item["platform"] for item in coverage}, {"youtube", "tiktok"}
        )
        self.assertEqual(
            next(item for item in coverage if item["platform"] == "tiktok")[
                "itemCount"
            ],
            1,
        )

    def test_versioned_snapshot_passes_strict_validation(self):
        snapshot = json.loads(
            (ROOT / "data" / "public-history.json").read_text(encoding="utf-8")
        )
        self.collector.validate_snapshot(snapshot, "all")

    def test_corrupt_existing_snapshot_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.json"
            path.write_text("{broken", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "sans écriture"):
                self.collector.load_existing_snapshot(path)

    def test_preserved_posts_keep_their_previous_observation_time(self):
        old_time = "2026-08-01T10:00:00Z"
        new_time = "2026-08-04T10:00:00Z"
        old_post = self.collector.seed_existing_observation_timestamps(
            {"platform": "tiktok", "externalId": "old", "raw": {}}, old_time
        )
        observed_post = self.collector.mark_post_observed(
            {"platform": "youtube", "externalId": "seen", "raw": {}}, new_time
        )

        self.assertEqual(old_post["raw"]["lastObservedAt"], old_time)
        self.assertEqual(observed_post["raw"]["firstObservedAt"], new_time)
        self.assertEqual(observed_post["raw"]["lastObservedAt"], new_time)

    def test_metric_sources_are_merged_key_by_key(self):
        current = {
            "platform": "youtube",
            "externalId": "one",
            "format": "short",
            "url": "https://www.youtube.com/shorts/one",
            "views": 10,
            "likes": None,
            "raw": {
                "collectionScopes": ["shorts"],
                "metricSources": {"views": "listing"},
            },
        }
        incoming = {
            **current,
            "likes": 5,
            "raw": {
                "collectionScopes": ["shorts"],
                "metricSources": {"likes": "video-api"},
            },
        }

        merged = self.collector.merge_posts(current, incoming)

        self.assertEqual(
            merged["raw"]["metricSources"],
            {"views": "listing", "likes": "video-api"},
        )

    def test_validation_rejects_negative_poll_votes_and_false_coverage(self):
        poll = {
            "platform": "youtube",
            "externalId": "poll",
            "url": "https://www.youtube.com/post/poll",
            "format": "community_poll",
            "thumbnailUrl": None,
            "views": None,
            "likes": 1,
            "comments": None,
            "shares": None,
            "saves": None,
            "raw": {"pollVotes": -5, "pollChoices": ["A", "B"]},
        }
        snapshot = {
            "coverage": [
                {
                    "platform": "youtube",
                    "accountUrl": "https://www.youtube.com/@LofiGirl",
                    "itemCount": 1,
                }
            ],
            "posts": [poll],
        }
        with self.assertRaisesRegex(RuntimeError, "votes invalide"):
            self.collector.validate_snapshot(snapshot, "youtube")

        snapshot["posts"][0]["raw"]["pollVotes"] = 5
        snapshot["coverage"][0]["itemCount"] = 999
        with self.assertRaisesRegex(RuntimeError, "couverture incohérente"):
            self.collector.validate_snapshot(snapshot, "youtube")


if __name__ == "__main__":
    unittest.main()
