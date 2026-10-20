-- e2e 干净样例：覆盖声明、记录、函数、报表、字段访问
-- 期望：0 条诊断
SCHEMA ds
GLOBALS "globals.4gl"

DEFINE g_count LIKE type_file.num5
DEFINE g_name  LIKE type_file.chr20

TYPE t_customer RECORD
    id   INTEGER,
    name VARCHAR(50)
END RECORD

MAIN
    DEFINE l_rec t_customer
    LET g_count = 0
    LET l_rec.id = 1
    LET l_rec.name = "abc"
    CALL show_name()
    DISPLAY g_name
END MAIN

FUNCTION show_name()
    DEFINE l_msg STRING

    LET l_msg = "name: ", g_name
    DISPLAY l_msg
    RETURN
END FUNCTION

REPORT r_list()
    DEFINE l_row INTEGER

    ORDER BY l_row
    FORMAT
        ON EVERY ROW
            PRINT l_row
END REPORT
