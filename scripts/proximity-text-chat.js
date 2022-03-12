import { libWrapper } from "../lib/shim.js";

const moduleName = "proximity-text-chat";
let vinoCreateChatMessage;

Hooks.once("init", () => {
    // Enable proximity chatting
    game.settings.register(moduleName, "proximityEnabled", {
        name: `${moduleName}.settings.proximityEnabled.name`,
        hint: "",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // Set grid distance that is considered "within proximity"
    game.settings.register(moduleName, "proximityDistance", {
        name: `${moduleName}.settings.proximityDistance.name`,
        hint: `${moduleName}.settings.proximityDistance.hint`,
        scope: "world",
        config: true,
        type: Number,
        default: 30,
        range: {
            min: 5,
            max: 200,
            step: 5
        }
    });

    // Set grid distance for tokens that can hear /scream commands
    game.settings.register(moduleName, "screamDistance", {
        name: `${moduleName}.settings.screamDistance.name`,
        hint: `${moduleName}.settings.screamDistance.hint`,
        scope: "world",
        config: true,
        type: Number,
        default: 60,
        range: {
            min: 5,
            max: 200,
            step: 5
        }
    });

    // Enable hiding of roll-type messages
    game.settings.register(moduleName, "hideRolls", {
        name: `${moduleName}.settings.hideRolls.name`,
        hint: "",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(moduleName, "hideBySight", {
        name: `${moduleName}.settings.hideBySight.name`,
        hint: "",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    // Set up module socket
    socket.on(`module.${moduleName}`, data => {
        const { action } = data;

        if (action === "showMessage") {
            if (game.user.id !== game.users.find(u => u.active && u.isGM).id) return; 
            const { messageID, userID } = data;
            if (game.users.get(userID).isGM) return;

            const message = game.messages.get(messageID);
            const hearMap = message.getFlag(moduleName, "users");
            if (!hearMap) return;
            hearMap[userID] = true;
            message.setFlag(moduleName, "users", hearMap);
        }

        if (action === "hideBySight") {
            if (game.user.id !== game.users.find(u => u.active && u.isGM).id) return;

            const { messageID, userID } = data;
            if (game.users.get(userID).isGM) return;
            const message = game.messages.get(messageID);
            const hearMap = message.getFlag(moduleName, "users");
            hearMap[userID] = false;
            message.setFlag(moduleName, "users", hearMap);
        }
    });

    libWrapper.register(moduleName, "ChatMessage.prototype.visible", function(wrapped) {
        const vis = wrapped();
        if (!vis) return false;
        if (game.user.isGM) return true;

        const hearMap = this.getFlag(moduleName, "users");
        if (!hearMap) return vis;
        return hearMap[game.user.id];
    }, "WRAPPER");
});

Hooks.once("setup", () => {
});

Hooks.once("ready", () => {
    // ViNo compatibility
    if (game.modules.get("vino")?.active) {
        vinoCreateChatMessage = Hooks._hooks.createChatMessage.find(f => f.name === "handleCreateChatMessage");
        Hooks.off("createChatMessage", vinoCreateChatMessage);
    }
});

Hooks.on("preCreateChatMessage", (message, data, options, userID) => {
    const oocTabActive = $(document).find(`nav.tabbedchatlog.tabs`).find(`a.item.ooc`).hasClass("active");
    if (message.data.type === 1 || oocTabActive) return;
    const speaker = [0,4,5].includes(message.data.type) ? canvas.tokens.controlled[0] : canvas.tokens.get(message.data.speaker.token);
    if (!speaker) return;

    if (!game.settings.get(moduleName, "hideRolls") && (message.data.type === 0 || message.data.type === 5)) return;

    // Initiate hearMap in message flag
    const hearMap = {};
    game.users.forEach(u => {
        if (u.isGM) return;
        hearMap[u.id] = false;
    });
    hearMap[game.user.id] = true;
    const update = {
        [`flags.${moduleName}`]: {
            "users": hearMap
        }
    };
    //if (message.data.type === 4) update[`flags.${moduleName}`].speaker = speaker.id;
    if ([0,4,5].includes(message.data.type)) update[`flags.${moduleName}`].speaker = speaker.id;
    message.data.update(update);

    // Prevent automatic chat bubble creation; will be handled manually in createChatMessge hook
    options.chatBubble = false;
    return;
});

Hooks.on("createChatMessage", (message, options, userID) => {
    const listener = canvas.tokens.controlled[0] || game.user.character?.getActiveTokens()[0];
    if (!listener) return;
    const speakerID = message.data.type === 4 ? message.getFlag(moduleName, "speaker") : message.data.speaker.token;
    const speaker = canvas.tokens.get(speakerID);
    if (!speaker) return;

    const d = canvas.grid.measureDistance(speaker, listener, { gridSpaces: true });
    const isScream = message.getFlag(moduleName, "isScream");
    let distanceCanHear = isScream ? game.settings.get(moduleName, "screamDistance") : game.settings.get(moduleName, "proximityDistance");
    const improvedHearingDistance = listener.document.getFlag(moduleName, "improvedHearingDistance");
    distanceCanHear += improvedHearingDistance || 0;
    let messageText = "......";
    const telepathyTarget = message.getFlag(moduleName, "telepathyTarget");
    let processHideBySight = true;
    if (game.settings.get(moduleName, "hideBySight") && !speaker.isVisible) processHideBySight = false;
    if (
        (d <= distanceCanHear || telepathyTarget === game.user.id) 
        && processHideBySight
    ) {
        // Set current user to true in hearMap
        socket.emit(`module.${moduleName}`, {
            action: "showMessage",
            messageID: message.id,
            userID: game.user.id
        });

        // Use true message text for chat bubble
        messageText = message.data.content;

        // ViNo compatibility
        if (game.modules.get("vino")?.active) vinoCreateChatMessage.call(this, message);
    }

    // Manually create chat bubble
    if (message.data.type === 2) canvas.hud.bubbles.say(speaker, messageText);
});

// Register Chat Commands
Hooks.on("chatCommandsReady", chatCommands => {
    const screamCommand = chatCommands.createCommandFromData({
        commandKey: "/scream",
        invokeOnCommand: (chatLog, messageText, chatData) => {
            Hooks.once("preCreateChatMessage", (message, data, options, userID) => {
                // Flag chat message as a scream
                message.data.update({
                    [`flags.${moduleName}`]: {
                        isScream: true
                    },
                    type: 2,
                });
            });
            //messageText = `<b>` + messageText + `</b>`; // clashes with ViNo compat
            return messageText;
        },
        shouldDisplayToChat: true,
        description: game.i18n.localize(`${moduleName}.screamDesc`)
    });
    chatCommands.registerCommand(screamCommand);

    const telepathyCommand = chatCommands.createCommandFromData({
        commandKey: "/telepathy",
        invokeOnCommand: (chatLog, messageText, chatData) => {
            const target = messageText.split(" ")[0];
            const user = game.users.getName(target);
            if (user) {
                Hooks.once("preCreateChatMessage", (message, data, options, userID) => {
                    // Flag chat message as telepathy and udpate message to a whisper
                    message.data.update({
                        [`flags.${moduleName}`]: {
                            telepathyTarget: user.id,
                            speaker: canvas.tokens.controlled[0].id
                        },
                        type: 2,
                        whisper: [user.id],
                        speaker: {
                            token: canvas.tokens.controlled[0].id
                        }
                    });
                });
            }

            //messageText = `<i>` + messageText + `</i>`; // clashes with ViNo compat
            return messageText.replace(target, "");
        },
        shouldDisplayToChat: true,
        description: game.i18n.localize(`${moduleName}.telepathyDesc`)
    });
    chatCommands.registerCommand(telepathyCommand);
});

// Implement improvedHearingDistance flag on tokens
Hooks.on("renderTokenConfig", (app, html, appData) => {
    html.find(`div.tab[data-tab="character"]`).append(`
        <div class="form-group slim">
            <label>
            ${game.i18n.localize(`${moduleName}.improvedHearingDistance`)}
            <span class="units">(${game.i18n.localize(`${moduleName}.gridUnits`)})</span>
            </label>
            <div class="form-fields">
                <input type="number" name="flags.${moduleName}.improvedHearingDistance" placeholder="0" value="${appData.object.flags[moduleName]?.improvedHearingDistance}" />
            </div>
        </div>
    `);
    html.css("height", "auto");
});
