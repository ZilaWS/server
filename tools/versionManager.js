const prompt = require("prompt");
const { exec, ChildProcess } = require("child_process");
const colors = require("@colors/colors");

prompt.start({
    colors: true,
    allowEmpty: true
});

/**
 * 
 * @param {string} args 
 * @returns {Promise<ChildProcess>} exitCode
 */
async function waitForProcess(args) {
    return new Promise((resolve, reject) => {
        const ret = exec(args, () =>{
            resolve(ret);
        });
    });
}

(async () => {
    console.log(colors.bold("\n------------------------\nWelcome to the Version Manager!"));
    console.log("Every new version you create will be automatically commited, pushed, and then released to Github Packages and NPM.");

    const version = (await prompt.get({
        pattern: /^((major|minor|patch|premajor|preminor|prepatch|prerelease|from-git)|\d+.\d+.\d+)$/,
        message: "Should be: major|minor|patch|premajor|preminor|prepatch|prerelease|from-git will increase version number by npm standards. Custom input is possible. Example: x.x.x",
        required: false,
        description: "New npm version",
        default: "patch"
    })).question.trim();

    let commitMessage = (await prompt.get({
        required: false,
        description: "This will be your commit's message. %s will be replaced with the new version number",
        default: /^(major|minor|patch|premajor|preminor|prepatch|prerelease|from-git)$/.test(version) ? `NPM auto incremented version for "${version}"` : version
    })).question.trim();

    if(commitMessage.startsWith("NPM auto incremented version for ")){
        commitMessage = undefined;
    }

    if ((await waitForProcess("git diff --exit-code .gitignore")).exitCode == 1) {
        await waitForProcess("git rm -r --cached .");
        await waitForProcess("git add -A");
    }
    
    await waitForProcess("git add .");
    
    if (commitMessage) {
        await waitForProcess(`npm version ${version} -m \"${commitMessage}\" --force`);
        commitMessage = commitMessage.replace("%s", require("../package.json").version);
        console.log(`${colors.green("Created new version and commited successfully")}\nNew version: ${colors.bold(require("../package.json").version)}\nCommit message: ${colors.bold(commitMessage)}`)
    } else {
        await waitForProcess(`npm version ${version} --force`);
        const newVersion = require("../package.json").version;
        console.log(`${colors.green("Created new version and commited successfully")}\nNew version: ${colors.bold(newVersion)}\nCommit message: ${colors.bold(newVersion)}\nPushing...`);
    }

    await waitForProcess("git push");
    await waitForProcess("git push --tags");
    console.log(colors.green("Pushed to remote successfully."));
})();