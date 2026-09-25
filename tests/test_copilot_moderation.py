"""Copilot abusive-language filter (apps/sales_copilot/moderation.py) — pure logic, no database."""

import pytest

from apps.sales_copilot.moderation import check, mask


@pytest.mark.parametrize("msg", [
    "fuck off", "you are fucking useless", "this is bullshit", "motherfucker", "f*ck you", "f u c k this",
    "fuuuuck", "sh1t answer", "$h!t", "you stupid bot", "you idiot", "shut up", "b!tch", "asshole",
    "you are a f*cking useless bot", "f**k", "sh*t", "b*tch please",
    "chutiya", "bhenchod kya hai ye", "madarchod", "bsdk", "gandu bot", "teri maa", "mc", "bc yaar",
])
def test_abusive_messages_are_flagged(msg):
    v = check(msg)
    assert v.abusive, msg
    assert v.masked != msg


@pytest.mark.parametrize("msg", [
    "Good morning", "Good mornming", "Prep me for a call with Robin Vince", "What's new at BNY?", "Scunthorpe United",
    "Send the assessment to Mr Dickson", "cocktail reception at the class", "analytics and assurance",
    "Which BNY VPs work in technology?", "shiitake", "Assistant Vice President, Pass-through Certificates",
    "Draft a follow up email to the MC of the event on Monday", "The BC province office", "Shut down the pilot?",
    "Kamal Bhenchikar", "Is the dashboard useless for finance teams?", "hell of a quarter",
    "Do they have operations in Niger?", "Hancock Whitney", "Essex County", "Cumberland", "Sussex",
])
def test_normal_business_messages_are_not_flagged(msg):
    assert not check(msg).abusive, msg


def test_mask_keeps_clean_words_and_first_letter():
    out = mask("please stop this bullshit now")
    assert out.startswith("please stop this b") and "bullshit" not in out and out.endswith("now")


def test_mask_leaves_clean_text_untouched():
    assert mask("Line one\nLine two") == "Line one\nLine two"


def test_mask_keeps_markdown_spacing():
    out = mask("- **Point:** fine\n  - nested   item with bullshit here").split("\n")
    assert out[0] == "- **Point:** fine" and out[1].startswith("  - nested   item with b") and "bullshit" not in out[1]


def test_starred_word_is_masked_not_just_flagged():
    v = check("you are a f*cking useless bot")
    assert v.abusive and "f*cking" not in v.masked
