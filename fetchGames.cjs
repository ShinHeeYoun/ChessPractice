const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://raw.githubusercontent.com/rozim/ChessData/master/kasparov.pgn';

https.get(url, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    const games = data.split('[Event ').filter(g => g.trim().length > 0).slice(0, 50).map(g => '[Event ' + g.trim());
    
    const formattedGames = games.map((pgn, i) => {
      const whiteMatch = pgn.match(/\[White "([^"]+)"\]/);
      const blackMatch = pgn.match(/\[Black "([^"]+)"\]/);
      const dateMatch = pgn.match(/\[Date "([^"]+)"\]/);
      
      const white = whiteMatch ? whiteMatch[1] : 'Unknown';
      const black = blackMatch ? blackMatch[1] : 'Unknown';
      const date = dateMatch ? dateMatch[1].substring(0,4) : 'Unknown';
      
      return {
        id: i,
        title: `${white} vs ${black} (${date})`,
        pgn: pgn
      };
    });

    const jsCode = `export const masterGames = ${JSON.stringify(formattedGames, null, 2)};`;
    
    fs.mkdirSync('src/data', { recursive: true });
    fs.writeFileSync('src/data/masterGames.js', jsCode);
    console.log('Successfully saved 50 games to src/data/masterGames.js');
  });
}).on('error', (err) => {
  console.error('Error fetching games:', err);
});
