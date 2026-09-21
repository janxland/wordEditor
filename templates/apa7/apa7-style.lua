-- APA 7 版式辅助过滤器（wordEditor `apa7` 模板专用）
--
-- 作用于 build.py 的第二段管道（HTML -> DOCX）。第一段（Markdown -> HTML）
-- 会把 Markdown 里的原始 HTML 原样带过来，因此这里以 HTML class 作为标记语言：
--
--   <div class="pagebreak"></div>          -> 分页符（w:br type="page"）
--   <div class="cs-XXX">...</div>          -> 段样式 XXX（对应 reference.docx 中的样式名）
--
-- 之所以不直接写 `custom-style` 属性：Markdown -> HTML 阶段 HTML writer 只输出
-- class/id，docx 专属的 custom-style 会被丢掉，只能在 HTML -> DOCX 阶段补回来。

-- 干掉 pandoc 从 HTML <head><title> 里读到的 title 元数据。
-- 第一段管道是 `pandoc ... --standalone`，输出 HTML 的 <title> 会落成输入文件名；
-- 第二段管道再读进来时，docx writer 会把 metadata.title 渲染成开头的「Title」段，
-- 在标题页上方凭空多出一行文件名。这里清掉，标题页完全由 Markdown 控制。
--
-- 注意：pandoc Lua 的 Meta 是 userdata，直接 `meta.title = nil` 并不会真的删键，
-- 必须重建一个 Meta，把不需要的键排除在外。
function Meta(meta)
  local keep = {}
  for k, v in pairs(meta) do
    if k ~= "title" and k ~= "subtitle" and k ~= "author" and k ~= "date" then
      keep[k] = v
    end
  end
  return pandoc.Meta(keep)
end

local function style_name_from_classes(classes)
  for _, c in ipairs(classes) do
    local name = c:match("^cs%-(.+)$")
    if name then
      return name
    end
  end
  return nil
end

local function has_class(classes, wanted)
  for _, c in ipairs(classes) do
    if c == wanted then
      return true
    end
  end
  return false
end

function Div(div)
  if has_class(div.classes, "pagebreak") then
    return pandoc.RawBlock("openxml",
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
  end

  local name = style_name_from_classes(div.classes)
  if name then
    local attr = div.attr
    local attrs = pandoc.Attr(attr.identifier or "", attr.classes or {},
      attr.attributes or {})
    attrs.attributes["custom-style"] = name
    return pandoc.Div(div.content, attrs)
  end

  return nil
end

return { { Meta = Meta, Div = Div } }
