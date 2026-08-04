#!/usr/bin/env python3
"""Collect a reproducible public-history snapshot for Lofi Girl social accounts.

The collector intentionally uses only public profile/listing pages. It does not
read browser cookies, API keys, OAuth tokens, or private analytics. Missing
fields remain null, and TikTok thumbnails are intentionally omitted because the
public URLs returned by the platform are signed and expire.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
YTDLP_VENDOR = ROOT / "work" / "ytdeps"
DEFAULT_OUTPUT = ROOT / "data" / "public-history.json"

if not YTDLP_VENDOR.is_dir():
    raise SystemExit(
        "yt-dlp est absent de work/ytdeps. Prépare cette dépendance avant la collecte."
    )
sys.path.insert(0, str(YTDLP_VENDOR))

from yt_dlp import YoutubeDL, version as yt_dlp_version  # noqa: E402


YOUTUBE_CHANNEL_ID = "UCSJ4gkVC6NrvII8umztf0Ow"
TIKTOK_HANDLE = "lofigirl"

SOURCES = (
    {
        "platform": "youtube",
        "scope": "videos",
        "accountUrl": "https://www.youtube.com/@LofiGirl/videos",
    },
    {
        "platform": "youtube",
        "scope": "shorts",
        "accountUrl": "https://www.youtube.com/@LofiGirl/shorts",
    },
    {
        "platform": "youtube",
        "scope": "streams",
        "accountUrl": "https://www.youtube.com/@LofiGirl/streams",
    },
    {
        "platform": "tiktok",
        "scope": "profile",
        "accountUrl": "https://www.tiktok.com/@lofigirl",
    },
)

STATIC_COVERAGE = (
    {
        "platform": "instagram",
        "accountUrl": "https://www.instagram.com/lofigirl/",
        "scope": "historical catalog",
        "status": "unavailable",
        "itemCount": 0,
        "oldestPublishedAt": None,
        "newestPublishedAt": None,
        "limitations": [
            "La page officielle déclare 1 673 publications au relevé du 4 août 2026.",
            "Le catalogue historique n’est pas récupérable de façon reproductible sans authentification et autorisations Meta.",
            "Aucun post ni aucune métrique Instagram ne sont ajoutés à ce snapshot pour éviter de simuler une couverture inexistante.",
        ],
    },
    {
        "platform": "x",
        "accountUrl": "https://x.com/lofigirl",
        "scope": "historical backfill",
        "status": "limited",
        "itemCount": 0,
        "oldestPublishedAt": None,
        "newestPublishedAt": None,
        "limitations": [
            "Le snapshot récent du rendu serveur public est collecté par le scanner temps réel et doit être fusionné séparément.",
            "Un historique complet et reproductible exige l’API X ou une archive de compte autorisée.",
            "Aucun post X n’est dupliqué dans ce backfill historique.",
        ],
    },
)

BASE_LIMITATIONS = {
    "youtube": [
        "Inventaire issu des onglets publics de la chaîne, sans YouTube Studio ni Analytics propriétaire.",
        "Les contenus privés, supprimés, réservés aux membres ou non listés ne sont pas accessibles.",
        "Les dates YouTube sont approximées par yt-dlp depuis les libellés relatifs des onglets publics, sauf date de diffusion planifiée explicitement fournie.",
        "Les likes, commentaires, partages, sauvegardes, impressions, rétention et abonnements générés ne sont pas exposés de façon fiable par les listes publiques.",
        "Les onglets peuvent se chevaucher ; le tableau posts est dédupliqué par identifiant vidéo.",
    ],
    "tiktok": [
        "Inventaire limité à ce que le profil public TikTok livre à yt-dlp au moment de la collecte ; l’exhaustivité historique n’est pas garantie.",
        "TikTok peut réduire ou bloquer la pagination publique sans préavis.",
        "Les miniatures TikTok sont volontairement omises car leurs URL publiques sont signées et expirent.",
        "Les métriques et dates absentes de la réponse publique restent nulles.",
    ],
}

SENSITIVE_KEY_PATTERN = re.compile(
    r"(?:cookie|authorization|access[_-]?token|refresh[_-]?token|password|secret)",
    re.IGNORECASE,
)
SIGNED_TIKTOK_PATTERN = re.compile(
    r"(?:x-signature|x-expires|x-bogus|signature=|token=)", re.IGNORECASE
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collecte l’historique public YouTube et TikTok de Lofi Girl."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Chemin du snapshot JSON (défaut: data/public-history.json).",
    )
    parser.add_argument(
        "--max-items",
        type=int,
        default=0,
        help="Limite par source pour un contrôle rapide ; 0 collecte toute la pagination publique.",
    )
    parser.add_argument(
        "--platform",
        choices=("all", "youtube", "tiktok"),
        default="all",
        help="Restreint la collecte à une plateforme.",
    )
    args = parser.parse_args()
    if args.max_items < 0:
        parser.error("--max-items doit être positif ou nul.")
    return args


def main() -> int:
    args = parse_args()
    selected_sources = [
        source
        for source in SOURCES
        if args.platform == "all" or source["platform"] == args.platform
    ]

    posts_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    source_coverages: list[dict[str, Any]] = []

    for source in selected_sources:
        scope_posts, source_coverage = collect_source(source, args.max_items)
        source_coverages.append(source_coverage)
        for post in scope_posts:
            key = (post["platform"], post["externalId"])
            current = posts_by_key.get(key)
            posts_by_key[key] = post if current is None else merge_posts(current, post)

    posts = sort_posts(posts_by_key.values())
    coverage = aggregate_coverage(
        source_coverages, posts, args.platform, limited_by_argument=bool(args.max_items)
    )
    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "coverage": coverage,
        "posts": posts,
    }
    validate_snapshot(snapshot, args.platform)

    output = args.output if args.output.is_absolute() else ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(output)

    print_summary(snapshot, output)
    return 0


def collect_source(
    source: dict[str, str], max_items: int
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    platform = source["platform"]
    scope = source["scope"]
    limitations = list(BASE_LIMITATIONS[platform])
    options: dict[str, Any] = {
        "skip_download": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
        "quiet": True,
        "no_warnings": True,
        "cachedir": False,
        "socket_timeout": 25,
        "retries": 2,
        "fragment_retries": 0,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/127.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    }
    if max_items:
        options["playlistend"] = max_items
        limitations.append(
            f"Collecte volontairement limitée à {max_items} éléments par source pour ce snapshot."
        )
    if platform == "youtube":
        options["extractor_args"] = {
            "youtubetab": {"approximate_date": [""]}
        }

    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(source["accountUrl"], download=False)
        if not isinstance(info, dict):
            raise RuntimeError("la source n’a renvoyé aucune liste publique")
        verify_account(source, info)

        entries = list(flatten_entries(info.get("entries")))
        normalized = [
            post
            for entry in entries
            if (post := normalize_entry(platform, scope, entry)) is not None
        ]
        normalized = deduplicate_scope(normalized)

        if len(normalized) < len(entries):
            limitations.append(
                f"{len(entries) - len(normalized)} entrée(s) sans identifiant public exploitable ont été ignorées."
            )
        status = "available" if normalized else "empty"
        return normalized, coverage_record(source, status, normalized, limitations)
    except Exception as error:  # yt-dlp exposes several extractor-specific errors
        limitations.append(f"Collecte indisponible : {clean_error(error)}")
        return [], coverage_record(source, "unavailable", [], limitations)


def flatten_entries(entries: Any) -> Iterable[dict[str, Any]]:
    if entries is None:
        return
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        nested = entry.get("entries")
        if nested is not None:
            yield from flatten_entries(nested)
        else:
            yield entry


def verify_account(source: dict[str, str], info: dict[str, Any]) -> None:
    platform = source["platform"]
    if platform == "youtube":
        observed = first_text(
            info.get("channel_id"),
            info.get("uploader_id"),
            info.get("playlist_uploader_id"),
        )
        if observed and observed.startswith("UC") and observed != YOUTUBE_CHANNEL_ID:
            raise RuntimeError(
                f"identité YouTube inattendue ({observed}, attendu {YOUTUBE_CHANNEL_ID})"
            )
        return

    identity_evidence = [
        first_text(info.get("uploader_id"), info.get("channel_id")),
        clean_text(info.get("title")),
        first_text(info.get("webpage_url"), info.get("original_url")),
    ]
    normalized_evidence = [value.lower().lstrip("@") for value in identity_evidence if value]
    if normalized_evidence and not any("lofigirl" in value for value in normalized_evidence):
        raise RuntimeError(
            f"identité TikTok inattendue ({identity_evidence[0] or identity_evidence[1]}, attendu @{TIKTOK_HANDLE})"
        )


def normalize_entry(
    platform: str, scope: str, entry: dict[str, Any]
) -> dict[str, Any] | None:
    external_id = entry_id(platform, entry)
    if not external_id:
        return None

    availability = clean_text(entry.get("availability"))
    title = clean_text(entry.get("title"))
    if availability in {"private", "subscriber_only", "needs_auth"}:
        return None
    if title and title.casefold() in {"[private video]", "[deleted video]"}:
        return None

    description = clean_text(entry.get("description"))
    if platform == "youtube":
        url = (
            f"https://www.youtube.com/shorts/{external_id}"
            if scope == "shorts"
            else f"https://www.youtube.com/watch?v={external_id}"
        )
        thumbnail_url = f"https://i.ytimg.com/vi/{external_id}/hqdefault.jpg"
        post_format = {
            "shorts": "short",
            "streams": "livestream",
        }.get(scope, "video")
    else:
        url = f"https://www.tiktok.com/@{TIKTOK_HANDLE}/video/{external_id}"
        # Never persist TikTok CDN thumbnails: they include expiring signatures.
        thumbnail_url = None
        post_format = "video"

    published_at = entry_datetime(entry)
    views = nonnegative_int(entry.get("view_count"))
    likes = nonnegative_int(entry.get("like_count"))
    comments = nonnegative_int(entry.get("comment_count"))
    shares = nonnegative_int(
        entry.get("repost_count")
        if entry.get("repost_count") is not None
        else entry.get("share_count")
    )
    saves = nonnegative_int(
        entry.get("save_count")
        if entry.get("save_count") is not None
        else entry.get("collect_count")
    )
    metric_sources: dict[str, str] = {}
    if views is not None:
        metric_sources["views"] = "yt-dlp view_count"
    if likes is not None:
        metric_sources["likes"] = "yt-dlp like_count"
    if comments is not None:
        metric_sources["comments"] = "yt-dlp comment_count"
    if shares is not None:
        metric_sources["shares"] = "yt-dlp repost_count/share_count"
    if saves is not None:
        metric_sources["saves"] = (
            "yt-dlp save_count, normalisé depuis TikTok collectCount public"
            if platform == "tiktok"
            else "yt-dlp save_count/collect_count"
        )
    post = {
        "platform": platform,
        "externalId": external_id,
        "url": url,
        "title": title,
        "text": description or (title if platform == "tiktok" else None),
        "format": post_format,
        "thumbnailUrl": thumbnail_url,
        "publishedAt": published_at,
        "views": views,
        "likes": likes,
        "comments": comments,
        "shares": shares,
        "saves": saves,
        "raw": {
            "collector": "yt-dlp",
            "collectorVersion": yt_dlp_version.__version__,
            "collectionScopes": [scope],
            "durationSeconds": nonnegative_number(entry.get("duration")),
            "publishedAtPrecision": (
                "exact"
                if platform == "tiktok" or entry.get("release_timestamp") is not None
                else "approximate"
            )
            if published_at is not None
            else None,
            "liveStatus": clean_text(entry.get("live_status")),
            "availability": availability,
            "metricSources": metric_sources,
        },
    }
    return post


def entry_id(platform: str, entry: dict[str, Any]) -> str | None:
    value = clean_text(entry.get("id"))
    if value:
        if platform == "youtube" and re.fullmatch(r"[A-Za-z0-9_-]{6,20}", value):
            return value
        if platform == "tiktok" and value.isdigit():
            return value

    url = first_text(entry.get("webpage_url"), entry.get("url")) or ""
    pattern = (
        r"(?:v=|shorts/|youtu\.be/)([A-Za-z0-9_-]{6,20})"
        if platform == "youtube"
        else r"/video/(\d+)"
    )
    match = re.search(pattern, url)
    return match.group(1) if match else None


def entry_datetime(entry: dict[str, Any]) -> str | None:
    for key in ("release_timestamp", "timestamp", "modified_timestamp"):
        value = entry.get(key)
        if isinstance(value, (int, float)) and value > 0:
            try:
                return (
                    datetime.fromtimestamp(value, tz=timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
            except (OverflowError, OSError, ValueError):
                pass

    upload_date = clean_text(entry.get("upload_date"))
    if upload_date and re.fullmatch(r"\d{8}", upload_date):
        try:
            return (
                datetime.strptime(upload_date, "%Y%m%d")
                .replace(tzinfo=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            )
        except ValueError:
            return None
    return None


def deduplicate_scope(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for post in posts:
        key = (post["platform"], post["externalId"])
        unique[key] = post if key not in unique else merge_posts(unique[key], post)
    return list(unique.values())


def merge_posts(
    current: dict[str, Any], incoming: dict[str, Any]
) -> dict[str, Any]:
    merged = dict(current)
    for field in (
        "title",
        "text",
        "thumbnailUrl",
        "publishedAt",
        "views",
        "likes",
        "comments",
        "shares",
        "saves",
    ):
        current_value = merged.get(field)
        incoming_value = incoming.get(field)
        if current_value is None:
            merged[field] = incoming_value
        elif (
            field in {"views", "likes", "comments", "shares", "saves"}
            and isinstance(current_value, (int, float))
            and isinstance(incoming_value, (int, float))
        ):
            merged[field] = max(current_value, incoming_value)

    format_priority = {"video": 0, "livestream": 1, "short": 2}
    if format_priority.get(incoming["format"], 0) > format_priority.get(
        merged["format"], 0
    ):
        merged["format"] = incoming["format"]
        merged["url"] = incoming["url"]

    raw = dict(merged.get("raw") or {})
    incoming_raw = incoming.get("raw") or {}
    scopes = set(raw.get("collectionScopes") or [])
    scopes.update(incoming_raw.get("collectionScopes") or [])
    raw["collectionScopes"] = sorted(scopes)
    for key in (
        "collector",
        "collectorVersion",
        "durationSeconds",
        "publishedAtPrecision",
        "liveStatus",
        "availability",
    ):
        if raw.get(key) is None and incoming_raw.get(key) is not None:
            raw[key] = incoming_raw[key]
    merged["raw"] = raw
    return merged


def coverage_record(
    source: dict[str, str],
    status: str,
    posts: list[dict[str, Any]],
    limitations: list[str],
) -> dict[str, Any]:
    dates = sorted(
        post["publishedAt"] for post in posts if post.get("publishedAt") is not None
    )
    return {
        "platform": source["platform"],
        "accountUrl": source["accountUrl"],
        "scope": source["scope"],
        "status": status,
        "itemCount": len(posts),
        "oldestPublishedAt": dates[0] if dates else None,
        "newestPublishedAt": dates[-1] if dates else None,
        "limitations": limitations,
    }


def aggregate_coverage(
    source_coverages: list[dict[str, Any]],
    posts: list[dict[str, Any]],
    platform_filter: str,
    *,
    limited_by_argument: bool,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    youtube_sources = [
        item for item in source_coverages if item["platform"] == "youtube"
    ]
    if youtube_sources:
        youtube_posts = [post for post in posts if post["platform"] == "youtube"]
        limitations = list(BASE_LIMITATIONS["youtube"])
        for item in youtube_sources:
            for limitation in item["limitations"]:
                if limitation not in limitations:
                    limitations.append(limitation)
        youtube_dated = sum(
            1 for post in youtube_posts if post.get("publishedAt") is not None
        )
        youtube_with_views = sum(
            1 for post in youtube_posts if post.get("views") is not None
        )
        if youtube_dated < len(youtube_posts):
            limitations.append(
                f"Une date est exposée pour {youtube_dated}/{len(youtube_posts)} contenus ; les bornes oldest/newest portent uniquement sur ce sous-ensemble daté."
            )
        if youtube_with_views < len(youtube_posts):
            limitations.append(
                f"Un compteur de vues est exposé pour {youtube_with_views}/{len(youtube_posts)} contenus ; les autres valeurs restent nulles."
            )
        statuses = {item["status"] for item in youtube_sources}
        status = (
            "complete-public-profile"
            if statuses == {"available"} and not limited_by_argument
            else "partial-public-profile"
            if youtube_posts
            else "unavailable"
        )
        result.append(
            aggregate_platform_record(
                platform="youtube",
                account_url="https://www.youtube.com/@LofiGirl",
                scope="videos + shorts + streams",
                status=status,
                posts=youtube_posts,
                limitations=limitations,
            )
        )

    tiktok_sources = [
        item for item in source_coverages if item["platform"] == "tiktok"
    ]
    if tiktok_sources:
        tiktok_posts = [post for post in posts if post["platform"] == "tiktok"]
        source = tiktok_sources[0]
        status = (
            "complete-public-profile"
            if source["status"] == "available" and not limited_by_argument
            else "partial-public-profile"
            if tiktok_posts
            else "unavailable"
        )
        result.append(
            aggregate_platform_record(
                platform="tiktok",
                account_url="https://www.tiktok.com/@lofigirl",
                scope="profile",
                status=status,
                posts=tiktok_posts,
                limitations=source["limitations"],
            )
        )

    if platform_filter == "all":
        result.extend(json.loads(json.dumps(STATIC_COVERAGE, ensure_ascii=False)))
    return result


def aggregate_platform_record(
    *,
    platform: str,
    account_url: str,
    scope: str,
    status: str,
    posts: list[dict[str, Any]],
    limitations: list[str],
) -> dict[str, Any]:
    dates = sorted(
        post["publishedAt"] for post in posts if post.get("publishedAt") is not None
    )
    return {
        "platform": platform,
        "accountUrl": account_url,
        "scope": scope,
        "status": status,
        "itemCount": len(posts),
        "oldestPublishedAt": dates[0] if dates else None,
        "newestPublishedAt": dates[-1] if dates else None,
        "limitations": list(dict.fromkeys(limitations)),
    }


def sort_posts(posts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    values = list(posts)
    dated = sorted(
        (post for post in values if post.get("publishedAt")),
        key=lambda post: (post["publishedAt"], post["platform"], post["externalId"]),
        reverse=True,
    )
    undated = sorted(
        (post for post in values if not post.get("publishedAt")),
        key=lambda post: (post["platform"], post["externalId"]),
    )
    return dated + undated


def validate_snapshot(snapshot: dict[str, Any], platform_filter: str) -> None:
    expected_urls = set()
    if platform_filter in {"all", "youtube"}:
        expected_urls.add("https://www.youtube.com/@LofiGirl")
    if platform_filter in {"all", "tiktok"}:
        expected_urls.add("https://www.tiktok.com/@lofigirl")
    if platform_filter == "all":
        expected_urls.update(
            {"https://www.instagram.com/lofigirl/", "https://x.com/lofigirl"}
        )
    actual_urls = {item["accountUrl"] for item in snapshot["coverage"]}
    if actual_urls != expected_urls:
        raise RuntimeError("la couverture ne correspond pas aux comptes officiels attendus")

    keys: set[tuple[str, str]] = set()
    for post in snapshot["posts"]:
        key = (post["platform"], post["externalId"])
        if key in keys:
            raise RuntimeError(f"doublon après normalisation : {key}")
        keys.add(key)
        if post["platform"] == "tiktok" and post["thumbnailUrl"] is not None:
            raise RuntimeError("une miniature TikTok signée a été conservée")
        if post["platform"] not in {"youtube", "tiktok"}:
            raise RuntimeError(f"plateforme inattendue : {post['platform']}")

    serialized = json.dumps(snapshot, ensure_ascii=False)
    if SIGNED_TIKTOK_PATTERN.search(serialized):
        raise RuntimeError("le snapshot contient une URL ou un paramètre TikTok signé")
    for post in snapshot["posts"]:
        if any(SENSITIVE_KEY_PATTERN.search(str(key)) for key in post["raw"]):
            raise RuntimeError("le snapshot contient une clé potentiellement sensible")


def print_summary(snapshot: dict[str, Any], output: Path) -> None:
    totals: dict[str, int] = {}
    for post in snapshot["posts"]:
        totals[post["platform"]] = totals.get(post["platform"], 0) + 1
    coverage_summary = ", ".join(
        f"{item['platform']}:{item['scope']}={item['itemCount']} ({item['status']})"
        for item in snapshot["coverage"]
    )
    print(f"Snapshot écrit : {output}")
    print(f"Posts uniques : {len(snapshot['posts'])} · {totals}")
    print(f"Couverture : {coverage_summary}")


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def first_text(*values: Any) -> str | None:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return None


def nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return int(value)
    return None


def nonnegative_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return int(value) if float(value).is_integer() else round(float(value), 3)
    return None


def clean_error(error: Exception) -> str:
    message = " ".join(str(error).split())
    return message[:300] if message else error.__class__.__name__


if __name__ == "__main__":
    raise SystemExit(main())
