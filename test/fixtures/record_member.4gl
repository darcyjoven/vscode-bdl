-- e2e record 成员校验样例（P6，默认 off）
-- 期望：recordMemberDiagnostics=warning 后报 tm.bad_member
TYPE t_rec RECORD
    good_one INTEGER,
    good_two STRING
END RECORD

DEFINE g_tm t_rec

MAIN
    OPEN WINDOW w WITH FORM "form_defs"
    DISPLAY BY NAME g_tm.good_one, g_tm.bad_member
END MAIN
