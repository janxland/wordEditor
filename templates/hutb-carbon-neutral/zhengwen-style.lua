--[[
  hutb-carbon-neutral 模板专用：按段落语义重定向到 reference.docx 中的命名样式。

  规则：
    - 包含 Link[id^="Ref"] 的段落（参考文献条目）            → custom-style "参考文献"
    - 仅含单个 Image 的段落                                  → custom-style "图"
    - Figure 中的 Caption                                    → custom-style "图注"
    - 其它裸正文段落                                         → custom-style "文章的正文"
    - 跳过 Header / CodeBlock / List / BlockQuote / Table 内部段落
    - 不动 Div 已经显式标了 custom-style 的段落
]]

local in_special = 0

local function wrap(style, blocks)
  return pandoc.Div(blocks, pandoc.Attr('', {}, { { 'custom-style', style } }))
end

function Header(_) return nil end

function BlockQuote(el)
  in_special = in_special + 1
  el = pandoc.walk_block(el, { Para = function(p) return p end })
  in_special = in_special - 1
  return el
end

function OrderedList(el)    return el end
function BulletList(el)     return el end
function DefinitionList(el) return el end
function CodeBlock(el)      return el end
function Table(el)          return el end

function Div(el)
  for _, kv in ipairs(el.attributes or {}) do
    if kv[1] == 'custom-style' then
      return el
    end
  end
  return nil
end

-- 段落开头形如  [ Link/Span[id^="Ref"] ]  → 参考文献条目
-- Pandoc HTML reader 把 <a id="X"> 无 href 读为 Span；有 href 读为 Link
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

-- 整段英文（不含任何 CJK 字符且非空）：
--   Abstract / Keywords / 纯英文段落 → custom-style "英文段落"
local function is_english_para(p)
  local s = pandoc.utils.stringify(p)
  if not s:find('%S') then return false end
  for _, cp in utf8.codes(s) do
    -- 命中 CJK 统一表意文字 / 扩充 A / 兼容表意文字 均视为中文
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
  if #el.content == 1 and el.content[1].t == 'Image' then
    return wrap('图', { el })
  end
  if is_bib_para(el) then
    return wrap('参考文献', { el })
  end
  if is_english_para(el) then
    return wrap('英文段落', { el })
  end
  return wrap('文章的正文', { el })
end

-- image-title-to-caption-add-number.lua 会把 ![](...) 包成 Figure；这里给 caption 套样式
-- 并自动加 "图 N　" 编号前缀（N 从 1 开始递增）
-- vendor 的 image-title-to-caption.lua 把 alt 丢掉、只用 title 作 caption；
-- 这里若 caption 为空，则回退使用图片自身的 alt（img.caption）作为标题文本
local fig_counter = 0

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
  -- 决定 caption 主体内容（Inlines）
  local cap_inlines = {}
  if fig.caption and fig.caption.long and #fig.caption.long > 0 then
    -- 取 long 第一个 Para 的 inlines
    local b = fig.caption.long[1]
    if b and b.content then
      for _, inl in ipairs(b.content) do cap_inlines[#cap_inlines + 1] = inl end
    end
  end
  if #cap_inlines == 0 then
    -- 回退：使用 Image 的 alt (img.caption)
    local img = _img_in_figure(fig)
    if img and img.caption and #img.caption > 0 then
      for _, inl in ipairs(img.caption) do cap_inlines[#cap_inlines + 1] = inl end
    end
  end
  -- 拼装最终 caption：图 N　原标题
  local prefix = pandoc.Str(string.format('图 %d　', fig_counter))
  table.insert(cap_inlines, 1, prefix)
  local cap_para = pandoc.Para(cap_inlines)
  return { img_div, wrap('图注', { cap_para }) }
end

