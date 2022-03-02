![All Downloads](https://img.shields.io/github/downloads/jessev14/proximity-text-chat/total?style=for-the-badge)

![Latest Release Download Count](https://img.shields.io/github/downloads/jessev14/proximity-text-chat/latest/PTC.zip)
[![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fproximity-text-chat&colorB=4aa94a)](https://forge-vtt.com/bazaar#package=proximity-text-chat)

This module was funded by a commission. Donations help fund upates and new modules!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jessev14)

# Proximity Text Chat

This module hides chat messages from token speakers that are a customizable distance away from the user's currently selected token.

## Demo
The left side of the video shows a GM user perspective. All messags are always visible to GM users.

The righ side shows the perspective of the user that owns the Aoth actor.

The red box show the currently set Proximity Distance, with respect to the Aoth token. Essentially, Zanna is within proximity of Aoth, while the Acolyte is outside proximity.

https://user-images.githubusercontent.com/68755874/156452257-150f2ef2-2330-4d22-b18a-1c88b521f9b4.mp4

## Usage
Proximity Distance is set in the module settings and is based on the scene's grid units.

## Additional Features
An optional module setting can be enabled to hide messages from tokens that are not visible to the user, even if the token is within Proximity Distance.

If the [**Library: Chat Commands**](https://foundryvtt.com/packages/_chatcommands) module is enabled, some additional features are available:
- `/scream`: This command allows a message to be heard outside of Proximity Distance, but still within a Scream Distance (also set in the module settings).
- `/telepathy username`: This command allows a token to send a direct message to the indicated user, regardless of distance between tokens.

## Compatibility
### Compatible
- [VIsual NOvel for FoundryVTT](https://foundryvtt.com/packages/vino)
- [Tabbed Chatlog](https://foundryvtt.com/packages/tabbed-chatlog)
### Incompatible
- Theatre Inserts

## Technical Notes
A hook callback is registered on `preCreateChatMessage` that creates a `hearMap` in the chat message's flags. The keys of this map are userIDs and the values indicate whether or not that user should be able to hear (see) that message. These values are initialized as `false`.

Another callback is registered on the `createChatMesasge` hook (which fires on all clients after `preCreateChatMessage`). This callback determines if the currently controlled token is within Proximity Distance of the chat message's token speaker. If so, a socket event is emitted instructing a GM client to update the chat message's `hearMap` to change the corresponding user's value to `true`.

To handle actually showing/hiding chat messages, the `ChatMessage#visible` getter is wrapped (via libWrapper). The wrapper checks if a `hearMap` is present on the chat message and uses the corresponding user value to determine if the message should be visible or not.
