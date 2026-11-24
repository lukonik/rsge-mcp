const DECIMAL_STRING_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export interface ExactDecimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

export function parseDecimal(value: number | string): ExactDecimal {
  const raw = typeof value === 'number' ? String(value) : value.trim();
  const match = DECIMAL_STRING_PATTERN.exec(raw);
  if (!match) {
    throw new Error(`Invalid decimal value: "${raw}"`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2]!;
  const fracPart = match[3] ?? '';
  const exponent = match[4] !== undefined ? Number.parseInt(match[4], 10) : 0;

  const combinedDigits = `${intPart}${fracPart}`;
  const rawScale = fracPart.length - exponent;

  if (rawScale < 0) {
    const scaleFactor = 10n ** BigInt(-rawScale);
    return {
      unscaled: sign * BigInt(combinedDigits) * scaleFactor,
      scale: 0,
    };
  }

  return {
    unscaled: sign * BigInt(combinedDigits),
    scale: rawScale,
  };
}

export function multiplyDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  return {
    unscaled: left.unscaled * right.unscaled,
    scale: left.scale + right.scale,
  };
}

export function roundDecimalHalfAwayFromZero(
  decimal: ExactDecimal,
  targetScale: number,
): ExactDecimal {
  if (decimal.scale === targetScale) {
    return decimal;
  }

  if (decimal.scale < targetScale) {
    const factor = 10n ** BigInt(targetScale - decimal.scale);
    return {
      unscaled: decimal.unscaled * factor,
      scale: targetScale,
    };
  }

  const diff = decimal.scale - targetScale;
  const factor = 10n ** BigInt(diff);
  const isNegative = decimal.unscaled < 0n;
  const absUnscaled = isNegative ? -decimal.unscaled : decimal.unscaled;
  const quotient = absUnscaled / factor;
  const remainder = absUnscaled % factor;
  const half = factor / 2n;
  const roundedAbs = remainder >= half ? quotient + 1n : quotient;

  return {
    unscaled: isNegative ? -roundedAbs : roundedAbs,
    scale: targetScale,
  };
}

export function addSameScaleDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  const maxScale = Math.max(left.scale, right.scale);
  const leftScaled =
    left.scale === maxScale
      ? left.unscaled
      : left.unscaled * 10n ** BigInt(maxScale - left.scale);
  const rightScaled =
    right.scale === maxScale
      ? right.unscaled
      : right.unscaled * 10n ** BigInt(maxScale - right.scale);

  return {
    unscaled: leftScaled + rightScaled,
    scale: maxScale,
  };
}

export function formatDecimal(decimal: ExactDecimal): string {
  const isNegative = decimal.unscaled < 0n;
  const absDigits = (isNegative ? -decimal.unscaled : decimal.unscaled).toString();

  if (decimal.scale === 0) {
    return `${isNegative ? '-' : ''}${absDigits}`;
  }

  const padded = absDigits.padStart(decimal.scale + 1, '0');
  const intPart = padded.slice(0, padded.length - decimal.scale);
  const fracPart = padded.slice(padded.length - decimal.scale);
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

export function formatDecimalTrimmed(decimal: ExactDecimal): string {
  if (decimal.unscaled === 0n) {
    return '0';
  }
  const formatted = formatDecimal(decimal);
  if (!formatted.includes('.')) {
    return formatted;
  }
  return formatted.replace(/0+$/, '').replace(/\.$/, '');
}

export function formatDecimalMinScale(
  decimal: ExactDecimal,
  minScale: number,
): string {
  const trimmed = formatDecimalTrimmed(decimal);
  if (minScale <= 0) {
    return trimmed;
  }
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) {
    return `${trimmed}.${'0'.repeat(minScale)}`;
  }
  const existingDecimals = trimmed.length - dotIndex - 1;
  if (existingDecimals >= minScale) {
    return trimmed;
  }
  return `${trimmed}${'0'.repeat(minScale - existingDecimals)}`;
}
