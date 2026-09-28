"""Main journey compatibility checks for the bundled report validator.

Run: python3 -m unittest discover -s docs/trace/skills/trace-report/scripts -p 'test_*.py'
"""
import copy
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker

from validate import semantic_errors


class MainJourneyValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        references = Path(__file__).parent.parent / "references"
        cls.fixture = json.loads((references / "example.trace.json").read_text())
        cls.schema = Draft202012Validator(
            json.loads((references / "schema.json").read_text()),
            format_checker=FormatChecker(),
        )

    def setUp(self):
        self.report = copy.deepcopy(self.fixture)

    def errors(self):
        errors = list(self.schema.iter_errors(self.report))
        return errors or semantic_errors(self.report)

    def test_older_report_omits_main_journey_without_inference(self):
        del self.report["mainJourney"]
        self.assertEqual(self.errors(), [])
        self.assertNotIn("mainJourney", self.report)

    def test_explicit_journey_is_independent_of_order_and_findings(self):
        supporting = copy.deepcopy(self.report["flows"][0])
        supporting["id"] = "flow-supporting"
        self.report["flows"].insert(0, supporting)
        self.report["findings"] = []
        self.report["summary"]["outcome"] = "no-blockers-found"
        self.assertEqual(self.errors(), [])
        self.assertNotEqual(self.report["mainJourney"]["flowId"], supporting["id"])

    def test_missing_flow_is_rejected(self):
        self.report["mainJourney"]["flowId"] = "missing-flow"
        self.assertIn("mainJourney.flowId: unknown reference missing-flow", self.errors())

    def test_blank_reason_is_rejected(self):
        for why in ("", " ", "\t\n", "\u00a0"):
            with self.subTest(why=repr(why)):
                self.report["mainJourney"]["why"] = why
                errors = list(self.schema.iter_errors(self.report))
                self.assertTrue(errors)
                self.assertTrue(all(list(error.absolute_path) == ["mainJourney", "why"] for error in errors))

    def test_no_flows_requires_omission(self):
        self.report["flows"] = []
        self.report["findings"] = []
        self.report["coverage"]["flowAnalysis"] = "not-assessed"
        self.report["coverage"]["note"] = "Behavioral flows have not been assessed."
        self.report["summary"]["outcome"] = "incomplete"
        self.assertIn("mainJourney.flowId: unknown reference flow-checkout", self.errors())
        del self.report["mainJourney"]
        self.assertEqual(self.errors(), [])

    def test_malformed_designation_is_rejected(self):
        for value in (None, {"flowId": "flow-checkout"}, {"why": "Central to the change."},
                      {"flowId": "flow-checkout", "why": "Central to the change.", "priority": "P1"}):
            with self.subTest(value=value):
                self.report["mainJourney"] = value
                self.assertTrue(list(self.schema.iter_errors(self.report)))


if __name__ == "__main__":
    unittest.main()
