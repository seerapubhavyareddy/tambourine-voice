"""Logging configuration using loguru for voice agent platform."""

import os
import sys

from loguru import logger


def configure_logging(log_level: str | None = None) -> None:
    """
    Configure loguru logging with sensible defaults.

    Args:
        log_level: Optional log level to use. If provided, takes precedence over
                   the LOG_LEVEL environment variable. Defaults to "INFO" if neither
                   is set.

    Configures log level and sets up colored output to stdout.
    """
    if log_level is not None:
        log_level_str = log_level.upper()
    else:
        log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()

    # Remove default handler
    logger.remove()

    # Add custom handler with colorization and formatting
    log_format = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>"
    )
    logger.add(
        sys.stdout,
        format=log_format,
        level=log_level_str,
        colorize=True,
    )
