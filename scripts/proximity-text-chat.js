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

    // Optionally hide OOC messages that are not in Proximity Distance
    game.settings.register(moduleName, "hideOOC", {
        name: `${moduleName}.settings.hideOOC.name`,
        hint: "",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });
    
    // Set up socket for handing chat bubble creation
    socket.on(`module.${moduleName}`, data => {
        const { action } = data;

        if (action === "chatBubble") {
            const { hearMap, tokenID } = data;
            let { messageText } = data;
            const token = canvas.tokens.get(tokenID);
            if (!token) return;

            if (!hearMap[game.user.id]) messageText = "......";
            canvas.hud.bubbles.say(token, messageText);
        }
    });
});

Hooks.once("setup", () => {
});

Hooks.on("preCreateChatMessage", (message, data, options, userID) => {
    let speaker = canvas.tokens.get(message.data.speaker.token);
    if (message.data.type === 4) speaker = canvas.tokens.controlled[0];
    const processOOC = message.data.type === 1 && game.settings.get(moduleName, "hideOOC");
    if (!speaker || processOOC) return;

    // Save hearMap in chat message flags
    const hearMap = createHearMap(speaker, game.settings.get(moduleName, "proximityDistance"), message.data.content);
    message.data.update({
        [`flags.${moduleName}`]: {
            "users": hearMap
        }
    });

    // Prevent automatic chat bubble creation (will be created manually in createHearMap() if user can see message)
    options.chatBubble = false;
});

// When rendering chat message, use hearMap data in chat message flag to determine if message should visible to current user
// If not, hide chat message html
Hooks.on("renderChatMessage", (message, html, data) => {
    const hearMap = message.getFlag(moduleName, "users");
    if (game.user.isGM || !hearMap || !message.visible) return;

    for (const [id, v] of Object.entries(hearMap)) {
        if (v && id === game.user.id) return;
    }

    html.hide();
});

function createHearMap(speaker, distanceCanHear, messageText) {
    // Collect tokens on canvas within proximity distance 
    const tokensThatCanHear = [];
    for (const token of canvas.tokens.placeables) {
        const d = canvas.grid.measureDistance(speaker, token, { gridSpaces: true });
        //const improvedHearingDistance = token.document.getFlag(moduleName, "improvedHearingDistance");
        //distanceCanHear += improvedHearingDistance || 0;
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

    // Create chat bubbles on other clients via socket
    const socketData = {
        action: "chatBubble",
        hearMap,
        tokenID: speaker.id,
        messageText
    };
    socket.emit(`module.${moduleName}`, socketData);
    canvas.hud.bubbles.say(speaker, messageText);

    return hearMap;
}
