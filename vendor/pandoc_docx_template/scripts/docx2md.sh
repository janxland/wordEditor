pandoc "input.docx" \
  -t gfm \
  -o output.md \
  --extract-media=./assets \
  --wrap=none