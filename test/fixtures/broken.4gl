-- e2e 故意有语法错误的样例：未闭合字符串
-- 期望：至少 1 条 error 级诊断（未闭合字符串从第 4 行第 13 列开始）
MAIN
    DISPLAY "it's unterminated
END MAIN
