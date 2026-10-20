-- e2e 格式化样例：关键字小写 + 缩进错乱
-- 期望：format.keywords=upper 后全大写；缩进按 indentSize 归一
schema ds

define l_count integer
define l_name string

main
define l_rec record
id integer,
name varchar(50)
end record
if l_count > 0 then
let l_name = "x"
else
let l_name = "y"
end if
call show_name(l_name)
end main

function show_name(p_name)
display p_name
return
end function
