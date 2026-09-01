from coworker.skillhub import _strip_front_matter


def test_strip_front_matter_removes_only_leading_delimited_block():
    source = "---\nname: ima-skill\ndescription: test\n---\n\n# ima-skill\n\n正文\n---\n尾部"
    assert _strip_front_matter(source) == "# ima-skill\n\n正文\n---\n尾部"


def test_strip_front_matter_preserves_markdown_without_leading_block():
    source = "# 标题\n\n正文\n---\n下一节"
    assert _strip_front_matter(source) == source


def test_strip_front_matter_preserves_unclosed_delimiter():
    source = "---\nname: incomplete\n# 正文"
    assert _strip_front_matter(source) == source
