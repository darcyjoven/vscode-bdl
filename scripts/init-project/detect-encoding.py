#!/usr/bin/env python3
"""样本编码检测（init-project.sh 用）。

输入：若干本地文件路径（从服务器取回的前 4KB 样本）。
输出：每个文件的猜测编码 + 前 3 个候选 + 各自解码预览，供用户挑选。

不依赖第三方库；判定规则是"能解码 + 解出来的常用汉字多 + 控制字符/替换符少"。
"""
import pathlib
import sys

CANDIDATES = ["utf-8", "gbk", "gb18030", "big5", "cp950", "euc-cn", "euc-tw", "latin-1"]


def score(text: str) -> int:
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    weird = sum(1 for ch in text if ch == "\ufffd" or (ord(ch) < 32 and ch not in "\t\r\n"))
    return cjk - 5 * weird


def detect(path: str):
    data = pathlib.Path(path).read_bytes()
    bom = data.startswith(b"\xef\xbb\xbf")
    body = data[3:] if bom else data
    out = []
    for enc in CANDIDATES:
        try:
            text = body.decode(enc)
        except Exception:
            continue
        out.append((enc, score(text), text))
    out.sort(key=lambda r: r[1], reverse=True)
    return out, bom


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: detect-encoding.py <样本文件>...", file=sys.stderr)
        return 2
    for path in sys.argv[1:]:
        results, bom = detect(path)
        if not results:
            print(f"FILE\t{path}\tBEST\tunknown\tSCORE\t0\tBOM\t{int(bom)}")
            continue
        best = results[0]
        print(f"FILE\t{path}\tBEST\t{best[0]}\tSCORE\t{best[1]}\tBOM\t{int(bom)}")
        for enc, sc, text in results[:3]:
            preview = text.replace("\r", "").replace("\n", " ")[:80]
            print(f"  alt\t{enc}\t{sc}\t{preview}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
