const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const pokeStartIdx = content.indexOf('<div id="poke-card"');
const pokeEndIdx = content.indexOf('<script src="js/poke.js"></script>');

if (pokeStartIdx !== -1 && pokeEndIdx !== -1) {
  const pokeContent = content.substring(pokeStartIdx, pokeEndIdx);
  let newContent = content.substring(0, pokeStartIdx) + content.substring(pokeEndIdx);
  
  const barIdx = newContent.indexOf('<div class="bar">');
  if (barIdx !== -1) {
    newContent = newContent.substring(0, barIdx) + pokeContent + '\n    ' + newContent.substring(barIdx);
    fs.writeFileSync('index.html', newContent, 'utf8');
    console.log('Successfully moved poke-card!');
  } else {
    console.log('Could not find bar index');
  }
} else {
  console.log('Could not find poke-card bounds');
}
