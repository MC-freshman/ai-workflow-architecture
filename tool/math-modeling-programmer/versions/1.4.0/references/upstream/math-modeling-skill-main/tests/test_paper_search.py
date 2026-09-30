import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "tools" / "paper_search" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from anysearch_academic import AnySearchAcademic
from hybrid_scholar import HybridScholar
from openalex_scholar import Paper
from openalex_scholar import OpenAlexScholar


class AnySearchParserTests(unittest.TestCase):
    def test_parses_markdown_mcp_response(self):
        response = {
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": """## Search Results (1 results)\n\n### 1. The Analytic Hierarchy Process\n- **URL**: https://doi.org/10.1016/0377-2217(85)90273-7\n- **Authors**: Thomas L. Saaty, Kevin P. Kearns\n- **Published**: 1985\n- **Citations**: 15444\n""",
                    }
                ]
            }
        }

        papers = AnySearchAcademic()._parse_response(response)

        self.assertEqual(len(papers), 1)
        self.assertEqual(papers[0]["title"], "The Analytic Hierarchy Process")
        self.assertEqual(papers[0]["doi"], "10.1016/0377-2217(85)90273-7")
        self.assertEqual(papers[0]["authors"], ["Thomas L. Saaty", "Kevin P. Kearns"])
        self.assertEqual(papers[0]["year"], 1985)
        self.assertEqual(papers[0]["citations"], 15444)


class OpenAlexMetadataTests(unittest.TestCase):
    def test_extracts_venue_volume_issue_pages_and_url(self):
        data = {
            "results": [
                {
                    "display_name": "A paper",
                    "authorships": [{"author": {"display_name": "A. Author"}}],
                    "publication_year": 2024,
                    "cited_by_count": 3,
                    "doi": "https://doi.org/10.1000/example",
                    "abstract_inverted_index": None,
                    "biblio": {"volume": "12", "issue": "3", "first_page": "10", "last_page": "20"},
                    "primary_location": {
                        "landing_page_url": "https://publisher.example/paper",
                        "source": {"display_name": "Journal of Examples"},
                    },
                }
            ]
        }

        paper = OpenAlexScholar()._parse_results(data)[0]

        self.assertEqual(paper.venue, "Journal of Examples")
        self.assertEqual(paper.volume, "12")
        self.assertEqual(paper.issue, "3")
        self.assertEqual(paper.pages, "10-20")
        self.assertEqual(paper.url, "https://publisher.example/paper")


class FusionTests(unittest.TestCase):
    def setUp(self):
        self.scholar = HybridScholar()
        self.scholar._current_query = "AHP"

    def test_title_match_without_doi_becomes_cross_validated(self):
        oa = [
            Paper(
                title="The Analytic Hierarchy Process",
                authors=["Thomas L. Saaty"],
                publication_year=1985,
                cited_by_count=100,
                doi=None,
                abstract=None,
            )
        ]
        anysearch = [
            {
                "title": "The analytic hierarchy process",
                "authors": ["Thomas L. Saaty"],
                "year": 1985,
                "citations": 90,
                "doi": None,
                "abstract": None,
            }
        ]

        result = self.scholar._fuse(oa, anysearch, final_limit=1)

        self.assertEqual(len(result["cross_validated"]), 1)
        self.assertEqual(result["cross_validated"][0].sources, ["openalex", "anysearch"])

    def test_single_engine_respects_requested_limit(self):
        oa = [
            Paper(f"Paper {i}", ["A"], 2020, 10 - i, None, None)
            for i in range(5)
        ]

        result = self.scholar._fuse(oa, [], final_limit=1)

        total = sum(
            len(result[key])
            for key in ("cross_validated", "openalex_only", "anysearch_only")
        )
        self.assertEqual(total, 1)

    def test_title_match_works_when_only_one_engine_has_doi(self):
        oa = [Paper("A Reliable Model", ["A"], 2022, 5, "10.1000/model", None)]
        anysearch = [{
            "title": "A reliable model",
            "authors": ["A"],
            "year": 2022,
            "citations": 4,
            "doi": None,
            "abstract": None,
        }]

        result = self.scholar._fuse(oa, anysearch, final_limit=1)

        self.assertEqual(result["cross_validated"][0].doi, "10.1000/model")

    def test_specialist_query_filters_topically_unrelated_high_citation_results(self):
        self.scholar._current_query = "Sellmeier 4H-SiC Fabry-Perot"
        oa = [
            Paper(
                "Graphene electro-optic modulation",
                ["A"], 2024, 5000, "10.1000/graphene", "Lithium niobate devices.",
            ),
            Paper(
                "Sellmeier dispersion and Fabry-Perot interference in 4H-SiC",
                ["B"], 2023, 10, "10.1000/sic", "Optical constants of silicon carbide.",
            ),
        ]

        result = self.scholar._fuse(oa, [], final_limit=5)
        selected = result["openalex_only"]

        self.assertEqual([paper.doi for paper in selected], ["10.1000/sic"])
        self.assertEqual(result["stats"]["filtered_irrelevant"], 1)

    def test_specialist_query_keeps_partial_match_when_metadata_has_no_abstract(self):
        self.scholar._current_query = "Sellmeier 4H-SiC Fabry-Perot"
        anysearch = [{
            "title": "Temperature dependence of the thermo-optic coefficient in 4H-SiC",
            "authors": [],
            "year": 2022,
            "citations": 0,
            "doi": "10.1000/partial",
            "abstract": None,
        }]

        result = self.scholar._fuse([], anysearch, final_limit=5)

        self.assertEqual([paper.doi for paper in result["anysearch_only"]], ["10.1000/partial"])

    def test_same_engine_duplicate_titles_with_different_dois_are_collapsed(self):
        self.scholar._current_query = "4H-SiC thermo-optic"
        anysearch = [
            {
                "title": "Temperature dependence of the thermo-optic coefficient in 4H-SiC",
                "authors": [], "year": 2022, "citations": 4,
                "doi": "10.1000/final", "abstract": None,
            },
            {
                "title": "Temperature Dependence of the Thermo Optic Coefficient in 4H SiC",
                "authors": [], "year": 2021, "citations": 0,
                "doi": "10.1000/preprint", "abstract": None,
            },
        ]

        result = self.scholar._fuse([], anysearch, final_limit=5)

        self.assertEqual([paper.doi for paper in result["anysearch_only"]], ["10.1000/final"])
        self.assertEqual(result["stats"]["collapsed_duplicates"], 1)


if __name__ == "__main__":
    unittest.main()
