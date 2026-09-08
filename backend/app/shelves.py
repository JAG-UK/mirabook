"""Themed shelves: the small, human-sized taxonomy the library groups books by.

Project Gutenberg already classifies its catalogue by hand — 96% of the Spanish
collection carries at least one "Category:" tag, and everything else has a
Library of Congress class — so shelves are derived from that rather than
guessed. The job here is only to fold PG's ~60 fine-grained categories into a
handful of shelves a reader can actually browse.

A book can carry several PG categories ("Novels" *and* "Historical Novels" *and*
"Classics of Literature"); SHELF_PRIORITY decides which one wins, preferring the
shelf that tells a reader most about what they are picking up.
"""

from __future__ import annotations

# The shelves themselves, in the order the library displays them.
SHELVES = [
    "Novels",
    "Short Stories",
    "Poetry",
    "Theatre",
    "Myth & Folklore",
    "History",
    "Lives & Letters",
    "Philosophy & Religion",
    "Travel & Places",
    "Society & Politics",
    "Science & Nature",
    "Arts & Culture",
    "For Younger Readers",
    "Language & Learning",
]
UNSHELVED = "Unshelved"

# Project Gutenberg "Category:" tag -> shelf.
_PG_CATEGORY_TO_SHELF = {
    # narrative fiction
    "Novels": "Novels",
    "Historical Novels": "Novels",
    "Romance": "Novels",
    "Adventure": "Novels",
    "Crime, Thrillers and Mystery": "Novels",
    "Science-Fiction & Fantasy": "Novels",
    "Classics of Literature": "Novels",
    "French Literature": "Novels",
    "British Literature": "Novels",
    "American Literature": "Novels",
    "German Literature": "Novels",
    "Russian Literature": "Novels",
    "Literature - Other": "Novels",
    "Short Stories": "Short Stories",
    "Humour": "Short Stories",
    "Poetry": "Poetry",
    "Plays/Films/Dramas": "Theatre",
    "Opera": "Theatre",
    "Mythology, Legends & Folklore": "Myth & Folklore",
    # history — PG splits this many ways; readers do not need that granularity
    "History - Other": "History",
    "History - Modern (1750+)": "History",
    "History - European": "History",
    "History - American": "History",
    "History - Early Modern (c. 1450-1750)": "History",
    "History - Warfare": "History",
    "History - Religious": "History",
    "History - Ancient": "History",
    "History - Royalty": "History",
    "History - Medieval/Middle Ages": "History",
    "History - Schools & Universities": "History",
    "Archaeology & Anthropology": "History",
    # the personal voice
    "Biographies": "Lives & Letters",
    "Essays, Letters & Speeches": "Lives & Letters",
    "Journals": "Lives & Letters",
    "Philosophy & Ethics": "Philosophy & Religion",
    "Religion/Spirituality": "Philosophy & Religion",
    "Travel Writing": "Travel & Places",
    "Politics": "Society & Politics",
    "Sociology": "Society & Politics",
    "Economics": "Society & Politics",
    "Law & Criminology": "Society & Politics",
    "Gender & Sexuality Studies": "Society & Politics",
    "Parenthood & Family Relations": "Society & Politics",
    "Environmental Issues": "Society & Politics",
    "Science - Earth/Agricultural/Farming": "Science & Nature",
    "Science - Biology": "Science & Nature",
    "Nature/Gardening/Animals": "Science & Nature",
    "Health & Medicine": "Science & Nature",
    "Psychiatry/Psychology": "Science & Nature",
    "Engineering & Technology": "Science & Nature",
    "Drugs/Alcohol/Pharmacology": "Science & Nature",
    "Art": "Arts & Culture",
    "Music": "Arts & Culture",
    "Architecture": "Arts & Culture",
    "Sports/Hobbies": "Arts & Culture",
    "Cooking & Drinking": "Arts & Culture",
    "Children & Young Adult Reading": "For Younger Readers",
    "Children's Instructional Books": "For Younger Readers",
    "Language & Communication": "Language & Learning",
    "Teaching & Education": "Language & Learning",
    "Encyclopedias/Dictionaries/Reference": "Language & Learning",
    "How To ...": "Language & Learning",
    "Journalism/Media/Writing": "Language & Learning",
    "Research Methods/Statistics/Information Sys": "Language & Learning",
}

# When a book carries several categories, the most specific shelf wins. "Novels"
# is last because PG tags a great many things as a novel in addition to
# something more informative.
SHELF_PRIORITY = [
    "For Younger Readers",
    "Poetry",
    "Theatre",
    "Myth & Folklore",
    "Short Stories",
    "Travel & Places",
    "Lives & Letters",
    "Philosophy & Religion",
    "Arts & Culture",
    "Science & Nature",
    "Society & Politics",
    "Language & Learning",
    "History",
    "Novels",
]

# Fallback for the few books with no PG category: the Library of Congress class
# letters, longest prefix first.
_LOCC_TO_SHELF = {
    "PQ": "Novels",
    "PR": "Novels",
    "PS": "Novels",
    "PA": "Novels",
    "PJ": "Novels",  # Spanish translations out of Arabic/Hebrew (the 1001 Nights)
    "PT": "Novels",  # …and out of German (Kafka)
    "PC": "Language & Learning",
    "PN": "Novels",
    "BS": "Philosophy & Religion",
    "BX": "Philosophy & Religion",
    "B": "Philosophy & Religion",
    "D": "History",
    "E": "History",
    "F": "History",
    "G": "Travel & Places",
    "H": "Society & Politics",
    "J": "Society & Politics",
    "K": "Society & Politics",
    "L": "Language & Learning",
    "M": "Arts & Culture",
    "N": "Arts & Culture",
    "Q": "Science & Nature",
    "R": "Science & Nature",
    "S": "Science & Nature",
    "T": "Science & Nature",
    "U": "History",
    "V": "History",
    "Z": "Language & Learning",
    "A": "Language & Learning",
}


def pg_categories(bookshelves: str) -> list[str]:
    """The "Category: X" tags out of a PG catalogue Bookshelves field."""
    out = []
    for part in bookshelves.split(";"):
        part = part.strip()
        if part.startswith("Category:"):
            out.append(part[len("Category:") :].strip())
    return out


def shelf_from_categories(categories: list[str]) -> str | None:
    """Best shelf for a set of PG categories, or None if none of them map."""
    hits = {_PG_CATEGORY_TO_SHELF[c] for c in categories if c in _PG_CATEGORY_TO_SHELF}
    return next((s for s in SHELF_PRIORITY if s in hits), None)


def shelf_from_locc(locc: str) -> str | None:
    """Best shelf for a Library of Congress class code (longest prefix wins)."""
    code = (locc or "").strip().upper()
    if not code:
        return None
    for length in (2, 1):
        if len(code) >= length and code[:length] in _LOCC_TO_SHELF:
            return _LOCC_TO_SHELF[code[:length]]
    return None


def normalize_shelf(name: str | None) -> str | None:
    """Map a proposed shelf name onto a real shelf, or None.

    A model is asked to choose from SHELVES but must never be trusted to have
    done so — an invented shelf would show up in the library as a category of
    one, and a stray "novels" would sit beside "Novels" as a separate section.
    """
    if not name:
        return None
    candidate = " ".join(str(name).split())
    if candidate in SHELVES:
        return candidate
    folded = candidate.casefold().rstrip(".")
    return next((s for s in SHELVES if s.casefold() == folded), None)


def shelf_for(bookshelves: str = "", locc: str = "") -> str | None:
    """The shelf for a catalogue row: PG's own categories first, LoCC second."""
    return shelf_from_categories(pg_categories(bookshelves)) or shelf_from_locc(locc)
