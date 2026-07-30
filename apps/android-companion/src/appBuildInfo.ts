import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { formatAppBuildLabel } from "./appBuildLabel";

export const appBuildLabel = formatAppBuildLabel({
  version: Application.nativeApplicationVersion,
  build: Application.nativeBuildVersion,
  publishedAt: Updates.createdAt
});
