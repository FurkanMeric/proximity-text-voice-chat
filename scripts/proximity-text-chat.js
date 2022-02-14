const moduleName = "proximity-text-chat";

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
});

Hooks.once("setup", () => {
});

Hooks.once("ready", () => { // TODO: fix
    // ViNo compatibility
    if (game.modules.get("vino")?.active) {
        const vinoCreateChatMessage = Hooks._hooks.createChatMessage.find(f => f.name === "handleCreateChatMessage");
        Hooks.off("createChatMessage", vinoCreateChatMessage);
        Hooks.on("createChatMessage", message => {
            let inProximity = true;
            const hearMap = message.getFlag(moduleName, "users");
            if (hearMap) inProximity = hearMap[game.user.id] || game.user.isGM;
            if (inProximity) return vinoCreateChatMessage.call(this, message);
        });
    }
});

Hooks.on("preCreateChatMessage", (message, data, options, userID) => {
    const speaker = message.data.type === 4 ? canvas.tokens.controlled[0] : canvas.tokens.get(message.data.speaker.token);
    if (!speaker) return;

    // Initiate hearMap in message flag
    const hearMap = {};
    game.users.forEach(u => {
        if (u.isGM) return;
        hearMap[u.id] = false;
    });
    message.data.update({
        [`flags.${moduleName}`]: {
            "users": hearMap
        }
    });

    // Prevent automatic chat bubble creation; will be handled manually in createChatMessge hook
    options.chatBubble = false;
    return;
});

Hooks.on("createChatMessage", (message, options, userID) => {
    const listener = canvas.tokens.controlled[0];
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
        socket.emit(`module.${moduleName}`, {
            action: "showMessage",
            messageID: message.id,
            userID: game.user.id
        });

        messageText = message.data.content;
    }

    canvas.hud.bubbles.say(speaker, messageText);
});

// When rendering chat message, use hearMap data in chat message flag to determine if message should visible to current user
// If not, hide chat message html
Hooks.on("renderChatMessage", (message, html, data) => {
    html.hide();
    const hearMap = message.getFlag(moduleName, "users");
    if (game.user.isGM || !hearMap) return html.show();

    for (const [id, v] of Object.entries(hearMap)) {
        if (v && id === game.user.id) return html.show();
    }
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
                    }
                });
            });
            messageText = `<b>` + messageText + `</b>`;
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
                        type: 4,
                        whisper: [user.id]
                    });
                });
            }
            messageText = `<i>` + messageText + `</i>`;
            return messageText;
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

function createHearMap(speaker, distanceCanHear, messageText) {
    // Collect tokens on canvas within proximity distance 
    const tokensThatCanHear = [];
    for (const token of canvas.tokens.placeables) {
        const d = canvas.grid.measureDistance(speaker, token, { gridSpaces: true });
        const improvedHearingDistance = token.document.getFlag(moduleName, "improvedHearingDistance");
        distanceCanHear += improvedHearingDistance || 0;
        if (d > distanceCanHear || !token.actor.hasPlayerOwner) continue;
        tokensThatCanHear.push(token);
    }

    // Create hearMap with: k = user ID (string) | v = whether user can hear (see) this message (Boolean)
    const hearMap = {};
    game.users.forEach(u => {
        if (u.isGM) return;
        hearMap[u.id] = false;
    });
    tokensThatCanHear.forEach(t => {
        for (const [id, prm] of Object.entries(t.actor.data.permission)) {
            if (id === "default" || game.users.get(id).isGM) continue;
            if (prm === 3) hearMap[id] = true;
        }
    });

    return hearMap;
}
