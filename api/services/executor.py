"""Code execution service — runs Python solutions against test cases."""
import sys, re, ast, os, tempfile, subprocess


# ── Input parser ─────────────────────────────────────────────────────────────

def _parse_input_assignments(input_str: str) -> list[str]:
    """'nums = [2,7], target = 9' → ['nums = [2,7]', 'target = 9']"""
    parts, depth, current = [], 0, ""
    i = 0
    while i < len(input_str):
        ch = input_str[i]
        if ch in "([{":  depth += 1
        elif ch in ")]}": depth -= 1
        if ch == "," and depth == 0:
            rest = input_str[i + 1:].lstrip()
            if re.match(r'[A-Za-z_]\w*\s*=', rest):
                parts.append(current.strip())
                current = ""
                i += 1
                continue
        current += ch
        i += 1
    if current.strip():
        parts.append(current.strip())
    return parts


# ── Harness builder ───────────────────────────────────────────────────────────

def _build_python_harness(user_code: str, input_str: str) -> str:
    m = re.search(r'def\s+(\w+)\s*\(self', user_code)
    if not m:
        return user_code

    method = m.group(1)
    parts = _parse_input_assignments(input_str)
    var_names = [re.match(r'([A-Za-z_]\w*)\s*=', p.strip()).group(1)
                 for p in parts if re.match(r'([A-Za-z_]\w*)\s*=', p.strip())]

    return (
        "from typing import List, Optional, Dict, Set, Tuple, Any\n"
        "import math, collections, heapq, bisect, functools, itertools\n"
        "from collections import defaultdict, Counter, deque\n\n"
        f"{user_code}\n\n"
        f"{chr(10).join(parts)}\n"
        f"_sol = Solution()\n"
        f"_result = _sol.{method}({', '.join(var_names)})\n"
        f"print(_result)\n"
    )


# ── Output comparison ─────────────────────────────────────────────────────────

def _outputs_match(actual: str, expected: str) -> bool:
    def py_norm(s: str) -> str:
        s = s.strip()
        s = re.sub(r'\btrue\b',  'True',  s)
        s = re.sub(r'\bfalse\b', 'False', s)
        s = re.sub(r'\bnull\b',  'None',  s)
        return s

    a, e = py_norm(actual), py_norm(expected)
    if a == e:
        return True
    try:
        return ast.literal_eval(a) == ast.literal_eval(e)
    except Exception:
        pass

    def tok(s: str) -> str:
        return re.sub(r'\s+', '', s)

    return tok(a) == tok(e)


# ── Public API ────────────────────────────────────────────────────────────────

def run_test_cases(code: str, language: str, test_cases: list) -> list:
    """Execute code against a list of {input, output} test cases."""
    results = []
    for tc in test_cases:
        inp = tc.get("input", "")
        exp = tc.get("output", "")

        if language != "Python":
            results.append({
                "input": inp, "expected": exp,
                "actual": f"'{language}' requires a compiler not available in this environment. Only Python is auto-executed.",
                "passed": False, "is_error": True,
            })
            continue

        harness = _build_python_harness(code, inp)
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
                f.write(harness)
                path = f.name

            proc = subprocess.run(
                [sys.executable, path],
                capture_output=True, text=True, timeout=10,
            )
            os.unlink(path)

            if proc.returncode != 0:
                actual = proc.stderr.strip()
                results.append({"input": inp, "expected": exp, "actual": actual, "passed": False, "is_error": True})
            else:
                actual = proc.stdout.strip()
                results.append({"input": inp, "expected": exp, "actual": actual,
                                 "passed": _outputs_match(actual, exp), "is_error": False})

        except subprocess.TimeoutExpired:
            results.append({"input": inp, "expected": exp, "actual": "Time Limit Exceeded (10s)",
                             "passed": False, "is_error": True})
        except Exception as exc:
            results.append({"input": inp, "expected": exp, "actual": str(exc),
                             "passed": False, "is_error": True})

    return results
