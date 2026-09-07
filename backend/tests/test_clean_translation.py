"""Tests for `clean_translation` — the regex-based tidy-up applied to every
model reply. It is tuned against observed instruct-model behaviour, so it is the
piece most likely to regress when the prompts or the model change.
"""

import pytest

from app.translate.base import clean_translation

ORIGINAL = "El ingenioso hidalgo."


def test_passes_clean_output_through_unchanged():
    assert clean_translation("The ingenious gentleman.", ORIGINAL) == "The ingenious gentleman."


def test_strips_surrounding_whitespace():
    assert clean_translation("  The gentleman.\n\n", ORIGINAL) == "The gentleman."


@pytest.mark.parametrize(
    "raw",
    [
        "Here is the translation: The gentleman.",
        "Here's the English translation: The gentleman.",
        "Here\u2019s the English translation: The gentleman.",
        "Translation: The gentleman.",
        "Translation (English): The gentleman.",
        "Sure, here you go: The gentleman.",
        "Sure! Here it is: The gentleman.",
    ],
)
def test_strips_leading_preamble(raw):
    assert clean_translation(raw, ORIGINAL) == "The gentleman."


@pytest.mark.parametrize(
    "raw",
    [
        '"The gentleman."',
        "'The gentleman.'",
        "\u201cThe gentleman.\u201d",
        "\u00abThe gentleman.\u00bb",
        "`The gentleman.`",
    ],
)
def test_unwraps_matched_quotes(raw):
    assert clean_translation(raw, ORIGINAL) == "The gentleman."


def test_unwraps_preamble_and_quotes_together():
    raw = 'Here is the translation: "The gentleman."'
    assert clean_translation(raw, ORIGINAL) == "The gentleman."


@pytest.mark.parametrize(
    "raw",
    [
        # No colon: there is no preamble to strip, so the whole reply is content.
        "Sure, the gentleman agreed.",
        "Here is the gentleman.",
        "The translation was a fine one.",
    ],
)
def test_leaves_preamble_words_alone_when_they_are_the_translation(raw):
    """Guards the greedy-match regression: the preamble strip must never
    consume a whole reply that merely starts with one of its keywords."""
    assert clean_translation(raw, ORIGINAL) == raw


def test_keeps_quotes_that_are_part_of_the_text():
    # Only a *wrapping* pair is stripped; internal quotation is content.
    raw = 'He said "hello" and left.'
    assert clean_translation(raw, ORIGINAL) == raw


@pytest.mark.parametrize(
    "raw",
    [
        "Please provide the text you would like translated.",
        "I cannot translate this.",
        "I can't help with that.",
        "I am unable to translate the provided text.",
        "As an AI language model, I need more context.",
        "No text was provided.",
        "There is no Spanish text to translate.",
        "I need the source text first.",
    ],
)
def test_falls_back_to_source_on_a_refusal(raw):
    assert clean_translation(raw, ORIGINAL) == ORIGINAL


def test_falls_back_to_source_on_empty_output():
    assert clean_translation("", ORIGINAL) == ORIGINAL
    assert clean_translation("   \n ", ORIGINAL) == ORIGINAL


def test_falls_back_when_a_preamble_was_the_whole_reply():
    assert clean_translation("Here is the translation:", ORIGINAL) == ORIGINAL


def test_refusal_match_is_not_anchored_to_the_start():
    """Known limitation, asserted so a change in behaviour is visible.

    The refusal patterns are searched anywhere in the reply, so a legitimate
    translation that happens to contain one of them is discarded in favour of
    the untranslated source. Rare in prose, but real.
    """
    assert clean_translation("Please provide the documents.", ORIGINAL) == ORIGINAL
