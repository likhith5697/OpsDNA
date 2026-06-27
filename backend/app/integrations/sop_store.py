"""ChromaDB-backed semantic search over the real SNOW KB SOPs.

Ported from a prior SRE agent implementation. Replaces exact-keyword SOP
matching with real similarity search: each SOP is embedded (title + operator
symptom phrases + overview text) into a local ChromaDB collection, synced
from ServiceNow on backend startup. A free-text incident description then
gets matched to the closest SOP even if the wording doesn't literally match.

Degrades gracefully to [] (never raises) if OPENAI_API_KEY/SNOW aren't
configured, or if the collection is empty -- callers must handle that and
fall back rather than guessing.
"""

import re

import chromadb
from chromadb.utils import embedding_functions

from app.core.config import settings
from app.integrations import snow_client

CHROMA_PATH = "/app/data/chromadb"

_client: chromadb.ClientAPI | None = None
_collection = None

# Operator-language symptom phrases per real SOP-K8S article (confirmed
# against the 6 SOPs actually published in this SNOW instance -- see
# snow_client._SOP_SEARCH_TERMS). Lets a vague free-text query like "pod
# keeps dying" land on the right SOP without needing exact title wording.
SOP_KEYWORDS: dict[str, list[str]] = {
    "SOP-K8S-001": [
        "crashloopbackoff", "crash loop", "pod restarting", "container dying",
        "keeps crashing", "exit code 137", "exit code 1", "oomkilled",
        "pod not stable", "restart count", "pod crash", "container crash",
    ],
    "SOP-K8S-002": [
        "high error rate", "500 errors", "5xx errors", "http errors spiking",
        "error rate above 5", "service errors", "requests failing", "api errors",
        "checkout failing", "errors increasing", "bad gateway", "internal server error",
    ],
    "SOP-K8S-003": [
        "high latency", "slow response", "p99 latency", "response time slow",
        "timeout", "requests timing out", "service slow", "api slow",
        "p95 high", "latency spike", "slow p99", "response degraded",
    ],
    "SOP-K8S-004": [
        "deployment failure", "rollout failed", "imagepullbackoff", "image pull error",
        "deployment stuck", "rollout stuck", "readiness probe failing", "new pods failing",
        "deploy failed", "deployment not completing",
    ],
    "SOP-K8S-005": [
        "configuration drift", "config drift", "configmap changed", "secret changed",
        "environment variable changed", "pod stale config", "config mismatch",
        "replica drift", "image drift", "env var drift",
    ],
    "SOP-K8S-006": [
        "service unavailable", "service down", "health check failing", "503 error",
        "service unreachable", "all pods down", "completely down", "no healthy backends",
        "service not responding", "outage",
    ],
}


def _configured() -> bool:
    return bool(settings.openai_api_key)


def _get_collection():
    global _client, _collection
    if _collection is not None:
        return _collection
    if not _configured():
        return None

    openai_ef = embedding_functions.OpenAIEmbeddingFunction(
        api_key=settings.openai_api_key,
        model_name="text-embedding-3-small",
    )
    _client = chromadb.PersistentClient(path=CHROMA_PATH)
    _collection = _client.get_or_create_collection(
        name="sops",
        embedding_function=openai_ef,
        metadata={"hnsw:space": "cosine"},
    )
    return _collection


def _strip_html(html: str) -> str:
    clean = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", clean).strip()


def _build_chunks(sop: dict) -> list[tuple[str, str, dict]]:
    """Split one SOP into focused embedding chunks: title, keywords, overview."""
    sys_id = sop["sys_id"]
    title = sop["short_description"]
    clean = _strip_html(sop.get("text", ""))

    sop_number = next((num for num in SOP_KEYWORDS if num in title), "")
    base_meta = {"sys_id": sys_id, "number": sop.get("number", ""), "sop_number": sop_number, "title": title}

    chunks: list[tuple[str, str, dict]] = [
        (f"{sys_id}_title", f"SOP title: {title}", {**base_meta, "chunk_type": "title"})
    ]

    keywords = SOP_KEYWORDS.get(sop_number, [])
    if keywords:
        chunks.append((f"{sys_id}_keywords", f"{title}. This SOP handles: {', '.join(keywords)}", {**base_meta, "chunk_type": "keywords"}))

    if clean:
        chunks.append((f"{sys_id}_overview", f"{title}. {clean[:400]}", {**base_meta, "chunk_type": "overview"}))

    return chunks


async def sync_sops_from_snow() -> int:
    """Fetch SOPs from ServiceNow KB and (re)embed them into ChromaDB.

    Non-fatal: returns 0 and logs a warning on any failure rather than
    raising, since this runs once at backend startup and must never block it.
    """
    collection = _get_collection()
    if collection is None:
        print("SOP semantic search not configured (no OPENAI_API_KEY) -- skipping sync")
        return 0

    sops = await snow_client._get(
        "/api/now/table/kb_knowledge",
        {
            "sysparm_query": "short_descriptionLIKESOP-^workflow_state=published^active=true",
            "sysparm_fields": "sys_id,number,short_description,text",
            "sysparm_limit": "50",
        },
    )
    if not sops:
        print("No SOPs found in ServiceNow KB -- semantic search will return no results")
        return 0

    try:
        existing = collection.get()
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    synced = 0
    for sop in sops:
        chunks = _build_chunks(sop)
        if not chunks:
            continue
        try:
            collection.upsert(ids=[c[0] for c in chunks], documents=[c[1] for c in chunks], metadatas=[c[2] for c in chunks])
            synced += 1
        except Exception as exc:
            print(f"Failed to embed SOP {sop.get('short_description', '')}: {exc}")

    print(f"SOP semantic search ready: {synced}/{len(sops)} SOPs embedded")
    return synced


def search_sops(query: str, n_results: int = 1) -> list[dict]:
    """Semantic search over embedded SOPs. Returns [] if unavailable or no good match."""
    collection = _get_collection()
    if collection is None:
        return []

    try:
        count = collection.count()
    except Exception:
        return []
    if count == 0:
        return []

    try:
        raw = collection.query(
            query_texts=[query],
            n_results=min(n_results * 4, count),
            include=["documents", "metadatas", "distances"],
        )

        best: dict[str, dict] = {}
        for doc, meta, dist in zip(raw["documents"][0], raw["metadatas"][0], raw["distances"][0]):
            similarity = round(1 - dist, 3)
            sys_id = meta["sys_id"]
            if sys_id not in best or similarity > best[sys_id]["similarity_score"]:
                best[sys_id] = {
                    "sop_number": meta.get("sop_number") or meta.get("number", ""),
                    "title": meta.get("title", ""),
                    "similarity_score": similarity,
                    "confidence": "HIGH" if similarity > 0.75 else "MEDIUM" if similarity > 0.55 else "LOW",
                    "sys_id": sys_id,
                    "matched_text": doc[:200],
                }

        results = sorted(best.values(), key=lambda x: x["similarity_score"], reverse=True)[:n_results]
        return [r for r in results if r["similarity_score"] > 0.4]
    except Exception as exc:
        print(f"SOP semantic search failed: {exc}")
        return []


async def get_sop_full_text(sys_id: str) -> str:
    """Fetch the full (HTML-stripped) body text for a SOP by sys_id."""
    results = await snow_client._get("/api/now/table/kb_knowledge", {"sysparm_query": f"sys_id={sys_id}", "sysparm_fields": "text", "sysparm_limit": "1"})
    if not results:
        return ""
    return _strip_html(results[0].get("text", ""))
