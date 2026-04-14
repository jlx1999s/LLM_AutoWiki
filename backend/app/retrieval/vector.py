from __future__ import annotations

import math
import re
from collections import Counter
from hashlib import md5


def _tokens(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def _hashed_index(token: str, dim: int) -> int:
    digest = md5(token.encode("utf-8"), usedforsecurity=False).hexdigest()
    return int(digest[:8], 16) % dim


def text_to_hashed_vector(text: str, dim: int = 256) -> list[float]:
    counts = Counter(_tokens(text))
    vector = [0.0] * dim
    for token, count in counts.items():
        idx = _hashed_index(token, dim)
        vector[idx] += float(count)

    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def vector_similarity(query: str, candidate: str, dim: int = 256) -> float:
    q_vec = text_to_hashed_vector(query, dim=dim)
    c_vec = text_to_hashed_vector(candidate, dim=dim)
    return cosine_similarity(q_vec, c_vec)

