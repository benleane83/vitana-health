import { registerWebModule, NativeModule } from 'expo';

// VitanaPinnedHttpModule is not available on the web platform.
class VitanaPinnedHttpModule extends NativeModule<{}> {}

export default registerWebModule(VitanaPinnedHttpModule, 'VitanaPinnedHttpModule');
