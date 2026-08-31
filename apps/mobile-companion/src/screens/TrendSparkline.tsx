import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../ui/theme";
import { sparklineGeometry } from "./dashboardMetrics";

const width = 112;
const height = 48;

export function TrendSparkline({ points }: { points: Array<{ value: number }> }) {
  const geometry = sparklineGeometry(points, width, height);
  if (!geometry) return null;

  return (
    <Svg
      accessibilityElementsHidden
      focusable={false}
      height={height}
      importantForAccessibility="no-hide-descendants"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      {geometry.count > 1 ? (
        <Path
          d={geometry.path}
          fill="none"
          stroke={colors.primary}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
        />
      ) : null}
      {geometry.lastPoint ? (
        <Circle cx={geometry.lastPoint.x} cy={geometry.lastPoint.y} fill={colors.primaryStrong} r={3.5} />
      ) : null}
    </Svg>
  );
}
