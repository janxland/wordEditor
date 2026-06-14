--[[
  hutb-shared 模板专用：按段落语义重定向到 reference.docx 中的命名样式。

  规则：
    - 段落 plain text == '摘要'                              → custom-style "摘要标题"，进入 in_zhaiyao
    - 段落 plain text == 'Abstract'（不区分大小写）          → custom-style "Abstract 标题"，进入 in_abstract
    - 段落以 '关键词' / 'Keywords' 起手                       → custom-style "关键词" / "Keywords"
    - in_zhaiyao 期间的中文段                                → custom-style "摘要"
    - in_abstract 期间的英文段                               → custom-style "Abstract"
    - 包含 Link/Span[id^="Ref"] 的段落                       → custom-style "参考文献"
    - 仅含单个 Image 的段落                                  → custom-style "图"
    - Figure 中的 Caption                                    → custom-style "图注"，并加 "图 N　" 前缀
    - Table 的 caption                                       → custom-style "表注" 移到表前，并加 "表 N　" 前缀
    - 行首为 "N、" "1." "1.1 " 等数字章节标题                 → 终止 in_zhaiyao/in_abstract（由 Python 后处理升级为 Heading）
    - 其它纯英文段                                           → custom-style "英文段落"
    - 其它裸正文段落                                         → custom-style "文章的正文"
    - 跳过 Header / CodeBlock / List / BlockQuote
    - 不动 Div 已经显式标了 custom-style 的段落
]]

local in_special = 0
local in_abstract = false
local in_zhaiyao = false
local fig_counter = 0
local table_counter = 0

local CN_NUMS = {
  ['一'] = true, ['二'] = true, ['三'] = true, ['四'] = true, ['五'] = true,
  ['六'] = true, ['七'] = true, ['八'] = true, ['九'] = true, ['十'] = true,
  ['百'] = true, ['千'] = true,
}

local function wrap(style, blocks)
  return pandoc.Div(blocks, pandoc.Attr('', {}, { { 'custom-style', style } }))
end

local function _header_plain(el)
  return pandoc.utils.stringify(el.content):gsub('%s+', ' '):match('^%s*(.-)%s*$') or ''
end

local function _trim(s)
  return (s or ''):gsub('^%s+', ''):gsub('%s+$', '')
end

-- 剥离用户手写的「图N / 表N」前缀，避免与自动编号叠加（表注常见写法是独立段落，图注多在 alt 中）
local CAP_LABEL = {
  figure = '^图%s*%d+[%s．%.：:、　]*',
  table  = '^表(?:格)?%s*%d+[%s．%.：:、　]*',
}

local function strip_caption_label(inlines, kind)
  if #inlines == 0 then return inlines end
  local pattern = CAP_LABEL[kind]
  if not pattern then return inlines end
  local plain = _trim(pandoc.utils.stringify(inlines))
  local rest = _trim(plain:gsub(pattern, '', 1))
  if rest == plain then return inlines end
  if rest == '' then return {} end
  return { pandoc.Str(rest) }
end

-- 段落首字符是中文章号（一/二/.../十/百/千），且紧跟「、」 → 视为章节标题
-- 数字 "1.1 " "1 " "1. " 同样视为章节标题
local function is_section_heading(text)
  if not text or text == '' then return false end
  if text:match('^%d+%.%d') then return true end
  if text:match('^%d+[%.%s]%s*%S') then return true end
  local first = text:sub(1, 3)        -- 中文字符 UTF-8 占 3 字节
  if CN_NUMS[first] and text:sub(1, 30):find('、') then
    return true
  end
  return false
end

-- 段落是否是关键词行：返回 'zh' / 'en' / nil
local function keywords_kind(p)
  local c = p.content
  if c and #c > 0 then
    local first = c[1]
    if first.t == 'Strong' then
      local s = pandoc.utils.stringify(first)
      if s == '关键词' then return 'zh' end
      if s == 'Keywords' or s == 'Key words' or s == 'KeyWords' then return 'en' end
    end
  end
  local plain = pandoc.utils.stringify(p)
  if plain:match('^关键词%s*[:：]') then return 'zh' end
  if plain:match('^[Kk]ey%s*[Ww]ords?%s*[:：]') then return 'en' end
  return nil
end

function Header(el)
  -- 同名 markdown header 也支持（虽然多数文档用 plain Para 写章节）
  local t = _header_plain(el):lower()
  in_abstract = (t == 'abstract')
  in_zhaiyao  = (t == '摘要')
  return nil
end

-- 进入容器型块时屏蔽 Para 重写（避免把列表项 Para 包成 Div 破坏 list 渲染）
local function _shielded(el)
  in_special = in_special + 1
  el = pandoc.walk_block(el, { Para = function(p) return p end })
  in_special = in_special - 1
  return el
end

function BlockQuote(el)     return _shielded(el) end
function OrderedList(el)    return _shielded(el) end
function BulletList(el)     return _shielded(el) end
function DefinitionList(el) return _shielded(el) end
function CodeBlock(el)      return el end

function Div(el)
  for _, kv in ipairs(el.attributes or {}) do
    if kv[1] == 'custom-style' then
      return el
    end
  end
  return nil
end

-- 段落开头形如  [ Link/Span[id^="Ref"] ]  → 参考文献条目
local function is_bib_para(p)
  local n = math.min(#p.content, 5)
  for i = 1, n do
    local inl = p.content[i]
    if inl.t == 'Link' or inl.t == 'Span' then
      local id = inl.attr and inl.attr.identifier or ''
      return id:match('^Ref%d+$') ~= nil
    end
  end
  return false
end

-- 整段英文（不含任何 CJK 字符且非空）→ 英文段落 / Abstract 等
local function is_english_para(p)
  local s = pandoc.utils.stringify(p)
  if not s:find('%S') then return false end
  for _, cp in utf8.codes(s) do
    if (cp >= 0x4E00 and cp <= 0x9FFF)
       or (cp >= 0x3400 and cp <= 0x4DBF)
       or (cp >= 0xF900 and cp <= 0xFAFF) then
      return false
    end
  end
  return true
end

function Para(el)
  if in_special > 0 then return nil end

  -- 1) 单图段（与摘要状态独立）
  if #el.content == 1 and el.content[1].t == 'Image' then
    return wrap('图', { el })
  end

  -- 2) 参考文献条目
  if is_bib_para(el) then
    in_zhaiyao, in_abstract = false, false
    return wrap('参考文献', { el })
  end

  local txt = _trim(pandoc.utils.stringify(el))

  -- 3) 「摘要」标题段
  if txt == '摘要' then
    in_zhaiyao, in_abstract = true, false
    return wrap('摘要标题', { el })
  end
  -- 4) 「Abstract」标题段
  if txt:lower() == 'abstract' then
    in_abstract, in_zhaiyao = true, false
    return wrap('Abstract 标题', { el })
  end

  -- 5) 关键词 / Keywords
  local kw = keywords_kind(el)
  if kw == 'zh' then
    in_zhaiyao = false
    return wrap('关键词', { el })
  end
  if kw == 'en' then
    in_abstract = false
    return wrap('Keywords', { el })
  end

  -- 6) 章节标题候选 → 终止摘要状态；样式委托给 Python 后处理升为 Heading
  if is_section_heading(txt) then
    in_zhaiyao, in_abstract = false, false
    return wrap('文章的正文', { el })
  end

  -- 7) 摘要正文
  if in_zhaiyao then
    return wrap('摘要', { el })
  end

  -- 8) Abstract 正文（要求英文段落）
  if in_abstract then
    if is_english_para(el) then
      return wrap('Abstract', { el })
    end
    in_abstract = false
  end

  -- 9) 其它纯英文段
  if is_english_para(el) then
    return wrap('英文段落', { el })
  end

  return wrap('文章的正文', { el })
end

-- ====== Table caption → 表注（表前 / 居中 / 自动编号） ======
function Table(tbl)
  table_counter = table_counter + 1
  local cap_inlines = {}
  if tbl.caption and tbl.caption.long and #tbl.caption.long > 0 then
    local b = tbl.caption.long[1]
    if b and b.content then
      for _, inl in ipairs(b.content) do cap_inlines[#cap_inlines + 1] = inl end
    end
  end
  if #cap_inlines == 0 then
    -- 没写 caption 时不强加表注
    return tbl
  end
  cap_inlines = strip_caption_label(cap_inlines, 'table')
  table.insert(cap_inlines, 1, pandoc.Str(string.format('表 %d　', table_counter)))
  -- 清掉表自带 caption，避免在表下再出现一份
  tbl.caption = { long = {}, short = nil }
  local cap_div = wrap('表注', { pandoc.Para(cap_inlines) })
  return { cap_div, tbl }
end

-- ====== Figure caption → 图注（图下 / 居中 / 自动编号） ======
local function _img_in_figure(fig)
  for _, blk in ipairs(fig.content) do
    if blk.t == 'Plain' or blk.t == 'Para' then
      for _, inl in ipairs(blk.content) do
        if inl.t == 'Image' then return inl end
      end
    end
  end
  return nil
end

function Figure(fig)
  fig_counter = fig_counter + 1
  in_special = in_special + 1
  fig = pandoc.walk_block(fig, { Para = function(p) return p end })
  in_special = in_special - 1
  local img_div = wrap('图', fig.content)
  local cap_inlines = {}
  if fig.caption and fig.caption.long and #fig.caption.long > 0 then
    local b = fig.caption.long[1]
    if b and b.content then
      for _, inl in ipairs(b.content) do cap_inlines[#cap_inlines + 1] = inl end
    end
  end
  if #cap_inlines == 0 then
    local img = _img_in_figure(fig)
    if img and img.caption and #img.caption > 0 then
      for _, inl in ipairs(img.caption) do cap_inlines[#cap_inlines + 1] = inl end
    end
  end
  cap_inlines = strip_caption_label(cap_inlines, 'figure')
  table.insert(cap_inlines, 1, pandoc.Str(string.format('图 %d　', fig_counter)))
  return { img_div, wrap('图注', { pandoc.Para(cap_inlines) }) }
end


