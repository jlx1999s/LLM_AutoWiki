import re
from collections import Counter


def tokenize(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def lexical_overlap_score(query: str, candidate: str) -> float:
    q_tokens = tokenize(query)
    c_tokens = tokenize(candidate)
    if not q_tokens or not c_tokens:
        return 0.0

    q_counter = Counter(q_tokens)
    c_counter = Counter(c_tokens)
    overlap = sum(min(q_counter[t], c_counter[t]) for t in q_counter)
    return overlap / max(len(q_tokens), 1)

