import { registerWebModule, NativeModule } from 'expo';

// LfaPinnedHttpModule is not available on the web platform.
class LfaPinnedHttpModule extends NativeModule<{}> {}

export default registerWebModule(LfaPinnedHttpModule, 'LfaPinnedHttpModule');
