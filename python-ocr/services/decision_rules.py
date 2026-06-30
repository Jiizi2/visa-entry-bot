"""Centralized decision rules and quality selector for OCR pipeline field mutations."""

import time
from typing import Any, Dict, Tuple
from services.log import logger
from services.scan_context import ScanContext

class AuthorityPolicy:
    """Defines authority levels for different data sources."""
    AUTHORITY_LEVELS = {
        "MRZ": 4,
        "INFERENCE": 3,
        "DICTIONARY": 2,
        "VISUAL": 1,
        "PANEL": 0
    }

    @staticmethod
    def get_level(source: str) -> int:
        return AuthorityPolicy.AUTHORITY_LEVELS.get(source, 0)


def evaluate_overwrite(
    current_value: str,
    current_meta: Dict[str, Any],
    new_value: str,
    new_source: str,
    new_confidence: float,
    new_validated: bool = False
) -> Tuple[bool, str]:
    """Determines whether a new field value should replace the current value.
    
    Implements the "Never Degrades" policy using a hierarchical quality selection:
    1. Authority Level (MRZ > INFERENCE > DICTIONARY > VISUAL > PANEL)
    2. Validation Status (Validated / Dictionary Match > Unvalidated)
    3. OCR Confidence Score
    """
    # Rule 1: Always allow if current value is empty or a placeholder
    if not current_value or current_value.strip().upper() in ("", "ID", "DNI", "N/A"):
        return True, "Current value is empty or a placeholder."

    # If the new candidate is empty or placeholder, do not replace a non-empty value
    if not new_value or new_value.strip().upper() in ("", "ID", "DNI", "N/A"):
        return False, "New value is empty or a placeholder."

    current_source = current_meta.get("source", "PANEL")
    current_conf = current_meta.get("confidence", 0.0)
    current_validated = current_meta.get("validated", False)

    current_level = AuthorityPolicy.get_level(current_source)
    new_level = AuthorityPolicy.get_level(new_source)

    # Rule 2: MRZ Checksum Passed is the ultimate authority for MRZ fields.
    # Never allow lower authority to replace verified MRZ data.
    if current_source == "MRZ" and current_validated and new_source != "MRZ":
        return False, "MRZ authority is higher (verified checksum passed)."

    # Rule 3: Hierarchical comparison: Authority Level
    if new_level > current_level:
        return True, f"New source '{new_source}' has higher authority level ({new_level}) than '{current_source}' ({current_level})."
    if new_level < current_level:
        return False, f"New source '{new_source}' has lower authority level ({new_level}) than '{current_source}' ({current_level})."

    # Rule 4: Equal authority: Compare validation status (dictionary matches / logic validations)
    if new_validated and not current_validated:
        return True, "New value is validated (logic check/dictionary matched) while current is unvalidated."
    if current_validated and not new_validated:
        return False, "Current value is validated while new value is not."

    # Rule 5: Equal authority and validation: Compare confidence scores
    if new_confidence > current_conf:
        return True, f"New value has higher confidence ({new_confidence}) than current value ({current_conf})."

    return False, f"New value does not have stronger evidence (Confidence: {new_confidence} <= {current_conf})."


class DecisionRules:
    """Unified entry point for evaluating and mutating passport field states."""

    @staticmethod
    def evaluate_and_update(
        ctx: ScanContext,
        field_name: str,
        value: str,
        source: str,
        confidence: float,
        tentative: bool = True,
        validated: bool = False
    ) -> bool:
        """Evaluates business rules and conditionally updates the field in ScanContext."""
        current_value = getattr(ctx.parsed, field_name, "")
        current_meta = ctx.field_metadata.get(field_name, {})

        can_replace, reason = evaluate_overwrite(
            current_value,
            current_meta,
            value,
            source,
            confidence,
            validated
        )

        if can_replace:
            DecisionRules.update_field(ctx, field_name, value, source, confidence, tentative, validated, reason)
            return True
        else:
            DecisionRules.record_rejection(ctx, field_name, value, source, confidence, validated, reason)
            return False

    @staticmethod
    def update_field(
        ctx: ScanContext,
        field_name: str,
        value: str,
        source: str,
        confidence: float,
        tentative: bool,
        validated: bool,
        reason: str
    ) -> None:
        """Safely mutates the parsed data object and updates metadata with decision trace."""
        # Clean value string
        cleaned_value = value.strip() if value else ""
        
        # Mutate the actual ParsedPassportData fields (keep flat structure compatibility)
        if isinstance(ctx.parsed, dict):
            ctx.parsed[field_name] = cleaned_value
        else:
            setattr(ctx.parsed, field_name, cleaned_value)

        # Write to merged_visual_fields as well to keep manifest compatibility
        if field_name == "placeOfBirth":
            ctx.merged_visual_fields["placeOfBirth"] = cleaned_value
        elif field_name == "issuingOffice":
            ctx.merged_visual_fields["issuingOffice"] = cleaned_value

        # Write metadata in parallel dictionary
        ctx.field_metadata[field_name] = {
            "value": cleaned_value,
            "source": source,
            "confidence": confidence,
            "tentative": tentative,
            "validated": validated,
            "decision": "ACCEPTED",
            "reason": reason,
            "timestamp": time.time()
        }
        logger.debug("[%s] Field '%s' ACCEPTED from source '%s': '%s' (Reason: %s)", ctx.file_name, field_name, source, cleaned_value, reason)

    @staticmethod
    def record_rejection(
        ctx: ScanContext,
        field_name: str,
        value: str,
        source: str,
        confidence: float,
        validated: bool,
        reason: str
    ) -> None:
        """Records a rejected overwrite candidate for observability and debugging."""
        cleaned_value = value.strip() if value else ""
        if "rejections" not in ctx.field_metadata:
            ctx.field_metadata["rejections"] = {}
            
        ctx.field_metadata["rejections"][field_name] = {
            "value": cleaned_value,
            "source": source,
            "confidence": confidence,
            "validated": validated,
            "decision": "REJECTED",
            "reason": reason,
            "timestamp": time.time()
        }
        logger.debug("[%s] Field '%s' REJECTED from source '%s': '%s' (Reason: %s)", ctx.file_name, field_name, source, cleaned_value, reason)
