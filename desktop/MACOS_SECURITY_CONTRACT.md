# Connect AI macOS Security Contract

This file records the macOS distribution security settings that are intentionally allowed for the Connect AI 0.4.8 desktop parity release.

## Hardened Runtime

The app must be packaged with `hardenedRuntime: true`, Developer ID signing, and notarization enabled.

When Developer ID signing material is not available, local diagnostic builds may apply an ad-hoc hardened-runtime signature after `app.asar.unpacked` resource restoration. This local signature is only for bundle resource seal and entitlement extraction verification; it is not a production release signature and does not satisfy Gatekeeper, notarization, or publication gates.

## Allowed Entitlements

The release uses the minimum entitlement set required by the current Electron/native runtime baseline:

- `com.apple.security.cs.allow-jit`: required by Chromium/Electron JavaScript execution paths.
- `com.apple.security.cs.allow-unsigned-executable-memory`: required by Electron and native inference dependencies.
- `com.apple.security.cs.disable-library-validation`: required for bundled native modules and runtime-loaded native libraries.
- `com.apple.security.cs.allow-dyld-environment-variables`: retained for parity with the shipped baseline and native runtime compatibility.
- `com.apple.security.device.audio-input`: required for microphone/audio capture features.

Forbidden for this release:

- `com.apple.security.get-task-allow`
- Any entitlement not listed above.

## App Transport Security

`NSAllowsArbitraryLoads` must stay `false` for production distribution. Local HTTP access is explicitly limited to:

- `127.0.0.1`
- `localhost`

No broad arbitrary-load allowance and no additional ATS exception domains are allowed without updating this contract and the verifier.

## Privacy Usage Strings

The packaged app must include usage descriptions for camera, microphone, audio capture, and Bluetooth access.
