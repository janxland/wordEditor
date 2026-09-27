"""给已构建的 docx 注入目录（TOC 域），插在文档第一个段落之后。

用法: python inject_toc.py <in.docx> [out.docx]
- 插入「目录」标题 + TOC 域 \\o "1-2" \\h \\z \\u
- settings.xml 写入 updateFields，Word 打开时自动刷新页码
"""
import re
import shutil
import sys
import tempfile
import zipfile

TOC_XML = (
    '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:line="360" w:lineRule="auto"/>'
    '<w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/></w:rPr></w:pPr>'
    '<w:r><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/></w:rPr>'
    '<w:t>目\u3000录</w:t></w:r></w:p>'
    '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>'
    '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
    '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>'
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    '<w:r><w:t>（打开文档后按 F9 或允许更新域即可生成目录）</w:t></w:r>'
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
)


def main(src, dst):
    with zipfile.ZipFile(src) as z:
        parts = {n: z.read(n) for n in z.namelist()}

    doc = parts["word/document.xml"].decode("utf-8")
    if "TOC \\o" in doc:
        print("已含目录域，跳过")
        return
    # 找到第一个段落结束处（标题段），在其后插入目录
    m = re.search(r"<w:body>.*?</w:p>", doc, re.S)
    if not m:
        raise SystemExit("找不到可插入位置")
    idx = m.end()
    doc = doc[:idx] + TOC_XML + doc[idx:]
    parts["word/document.xml"] = doc.encode("utf-8")

    settings = parts["word/settings.xml"].decode("utf-8")
    if "updateFields" not in settings:
        # schema 顺序：updateFields 必须在 footnotePr/endnotePr/compat/docVars/rsids 之前
        anchor = None
        for tag in ("<w:footnotePr", "<w:endnotePr", "<w:compat", "<w:docVars", "<w:rsids"):
            i = settings.find(tag)
            if i != -1 and (anchor is None or i < anchor):
                anchor = i
        elem = '<w:updateFields w:val="true"/>'
        settings = (
            settings[:anchor] + elem + settings[anchor:]
            if anchor is not None
            else settings.replace("</w:settings>", elem + "</w:settings>")
        )
        parts["word/settings.xml"] = settings.encode("utf-8")

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in parts.items():
            z.writestr(n, b)
    print("写入:", dst)


if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    if dst == src:
        tmp = tempfile.mktemp(suffix=".docx")
        main(src, tmp)
        shutil.move(tmp, src)
    else:
        main(src, dst)
