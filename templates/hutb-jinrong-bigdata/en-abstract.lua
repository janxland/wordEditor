--[[
  hutb-jinrong-bigdata 专用：英文摘要 / KEY WORDS 的样式重定向。

  为什么需要它
  ------------
  hutb-shared/zhengwen-style.lua 把英文摘要统一 wrap 成「文章的正文」
  （宋体小四）。但《金融大数据与Python程序应用》模板的文字要求写的是：

      [ABSTRACT]   …（四号 Times New Roman 字体，行距固定值 24 磅）
      [KEY WORDS]  …（四号 Times New Roman 字体）

  中文摘要是四号宋体、正文才是小四宋体 —— 英文摘要必须单独走
  AbstractTitle / Abstract / Keywords，否则字号字体都与模板要求不符。

  为什么只能在 Div 层改写
  ------------------------
  extra_lua_filters 排在 zhengwen-style.lua **之后**，等本过滤器运行时段落
  已经被包进 Div(custom-style='文章的正文') 了，Para 钩子再也拿不到它，
  所以只能遍历 Blocks 改 Div 的 custom-style。
]]
local function plain(b)
  return (pandoc.utils.stringify(b) or ''):gsub('^%s+', ''):gsub('%s+$', '')
end

local function is_english(b)
  local s = pandoc.utils.stringify(b)
  if not s:find('%S') then return false end
  for _, cp in utf8.codes(s) do
    if (cp >= 0x4E00 and cp <= 0x9FFF) or (cp >= 0x3400 and cp <= 0x4DBF) then
      return false
    end
  end
  return true
end

-- [ABSTRACT] / ABSTRACT / Abstract（方括号可选，整段只有这个词才算标题）
local ABSTRACT_TITLE = '^%[?%s*[Aa][Bb][Ss][Tt][Rr][Aa][Cc][Tt]%s*%]?%s*$'
-- [KEY WORDS] … / Key words: …
local KEYWORDS_LINE = '^%[?%s*[Kk][Ee][Yy]%s*[Ww][Oo][Rr][Dd][Ss]?%s*%]?%s*[:：]?'

function Blocks(bs)
  local in_abstract = false
  for _, b in ipairs(bs) do
    if b.t == 'Div' then
      local cs = b.attributes and b.attributes['custom-style']
      local txt = plain(b)
      if cs == '文章的正文' or cs == 'BodyText' or cs == nil then
        if txt:match(ABSTRACT_TITLE) then
          b.attributes['custom-style'] = 'AbstractTitle'
          in_abstract = true
        elseif txt:match(KEYWORDS_LINE) then
          b.attributes['custom-style'] = 'Keywords'
          in_abstract = false
        elseif in_abstract and is_english(b) then
          b.attributes['custom-style'] = 'Abstract'
        end
      end
    elseif b.t == 'Header' then
      in_abstract = false          -- 章节标题出现即结束英文摘要区
    end
  end
  return bs
end
