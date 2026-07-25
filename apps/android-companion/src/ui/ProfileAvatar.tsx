import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { UserRound } from "lucide-react-native";
import { colors } from "./theme";

export function ProfileAvatar({ uri, size = 42 }: { uri?: string; size?: number }) {
  const [failedUri, setFailedUri] = useState<string>();
  const showPhoto = uri && uri !== failedUri;
  return (
    <View style={[styles.container, { borderRadius: size / 2, height: size, width: size }]}>
      {showPhoto ? (
        <Image
          accessibilityIgnoresInvertColors
          onError={() => setFailedUri(uri)}
          source={{ uri }}
          style={{ height: size, width: size }}
        />
      ) : (
        <UserRound color={colors.primary} size={Math.round(size / 2)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: colors.surface,
    justifyContent: "center",
    overflow: "hidden"
  }
});
