const packageJSON = require("../package.json");

function getPackageName(){
    return packageJSON.name;
}

module.exports = {
    getPackageName
}