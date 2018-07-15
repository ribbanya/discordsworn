const discord = require("discord.js");
const lokidb = require("@lokidb/loki")
const client = new discord.Client();

//TODO: True RNG

login();

client.on("ready", () => {
    console.log("I am ready!");
});

client.on("message", (msg) => {
    args = msg.content.split(' ');
    const chan = msg.channel;
    switch (args[0].substring(1).toLowerCase()) {
        case "act":
        case "a":
            actionRoll(msg, args.slice(1));
            break;
        case "rngtest":
            var s = rInts(1, 9, 1000);
            s = s.join(' ');
            chan.send(s);
            break;
        case "shutdown":
            shutdown(chan);
            break;
        case "reset":
            reset(chan);
            break;
    }
});

function rInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rInts(min, max, count) {
    return Array.apply(null, Array(count)).map(n => rInt(min, max))
}

function actionRoll(msg, modifiers) {
    var chan = msg.channel;
    var mods = modifiers.reduce(function (m, s) {
        return m + parseInt(s);
    }, 0);
    var challenge = rInts(1, 10, 2);
    var action = rInt(1, 6);
    var challengeStr = challenge.map(n => (action + mods) > n ? `__${n}__` : n);
    modStr = modifiers.length > 0 ? modifiers.join('+') : '0';
    var result = ''
        + `**${action + mods}** (**${action}**+${modStr})`
        + ` vs. **${challengeStr[0]}** & **${challengeStr[1]}**`;

    //var success = challenge.reduce(n => (action + mods) > n ? 1 : 0, 0);
    var success = 0;
    for (var i = 0; i < challenge.length; i++) {
        if (action + mods > challenge[i])
            success++;
    }

    var successStr = ["Miss...", "Weak hit!", "_Strong hit!_"][success];
    result += `\n${msg.author} ${successStr}`

    if (challenge[0] == challenge[1])
        result += ' _MATCH!_';
    chan.send(result)
}

function login() {
    client.login("NDY4MDUxMDkxNjM3MDEwNDQ1.Dizlew.drt6ycuCPEm6bl-3mkA5YNvp6TU");
}

function reset(channel) {
    channel.send('Resetting...')
        .then(msg => client.destroy())
        .then(() => login());
}

function shutdown(channel) {
    channel.send("Shutting down.")
        .then(msg => client.destroy());
}