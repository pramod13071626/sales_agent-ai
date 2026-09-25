"""ChromaDB access (README §4.1–4.2). Chroma is a derived, rebuildable index of
Postgres: ids are deterministic ("{chunk_hash_hex}:{account_id}") so upserts are
idempotent and a duplicate vector can't exist. Only this module talks to Chroma."""

import threading
from typing import Any, Dict, List, Optional

from apps.sales_copilot import settings

_client = None
_collections: Dict[str, Any] = {}
_lock = threading.Lock()


def client():
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                import chromadb
                if settings.CHROMA_URL:
                    from urllib.parse import urlparse
                    u = urlparse(settings.CHROMA_URL)
                    _client = chromadb.HttpClient(host=u.hostname, port=u.port or 8000, ssl=u.scheme == "https")
                else:
                    _client = chromadb.PersistentClient(path=settings.CHROMA_PATH)
    return _client


def collection(name: str):
    if name not in _collections:
        _collections[name] = client().get_or_create_collection(
            name,
            configuration={"hnsw": {"space": "cosine"}},
            embedding_function=None,  # we always pass our own embeddings
        )
    return _collections[name]


def record_id(chunk_hash: bytes, account_id: int) -> str:
    return f"{chunk_hash.hex()}:{account_id}"


def upsert(name: str, ids: List[str], embeddings: List[List[float]], documents: List[str],
           metadatas: List[Dict[str, Any]], batch: int = 500) -> None:
    col = collection(name)
    for i in range(0, len(ids), batch):
        col.upsert(ids=ids[i:i + batch], embeddings=embeddings[i:i + batch],
                   documents=documents[i:i + batch], metadatas=metadatas[i:i + batch])


def delete(name: str, ids: List[str], batch: int = 500) -> None:
    col = collection(name)
    for i in range(0, len(ids), batch):
        col.delete(ids=ids[i:i + batch])


def query(name: str, embedding: List[float], n: int, where: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    col = collection(name)
    if col.count() == 0:
        return []
    res = col.query(query_embeddings=[embedding], n_results=n, where=where, include=["metadatas", "distances"])
    out = []
    for rid, meta, dist in zip(res["ids"][0], res["metadatas"][0], res["distances"][0]):
        out.append({"id": rid, "chunk_hash": bytes.fromhex(rid.split(":")[0]), "meta": meta or {}, "distance": dist})
    return out


def all_ids(name: str, page: int = 5000) -> List[str]:
    col = collection(name)
    ids, offset = [], 0
    while True:
        got = col.get(include=[], limit=page, offset=offset)["ids"]
        ids.extend(got)
        if len(got) < page:
            return ids
        offset += page


def count(name: str) -> int:
    return collection(name).count()
