import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export default function ChessGame() {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [status, setStatus] = useState('Your turn to move.');
  const [difficulty, setDifficulty] = useState(5); // Stockfish skill level (0-20)
  const engineRef = useRef(null);

  // Initialize Stockfish worker
  useEffect(() => {
    // Vite serves public files from the root path
    engineRef.current = new Worker('/stockfish.js');
    
    engineRef.current.onmessage = (event) => {
      const line = event.data;
      if (line && typeof line === 'string') {
        if (line.startsWith('bestmove')) {
          const move = line.split(' ')[1];
          if (move && move !== '(none)') {
            makeEngineMove(move);
          }
        }
      }
    };

    // Initialize engine
    engineRef.current.postMessage('uci');
    engineRef.current.postMessage('isready');

    return () => {
      engineRef.current.terminate();
    };
  }, []);

  // Update difficulty when changed
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.postMessage(`setoption name Skill Level value ${difficulty}`);
    }
  }, [difficulty]);

  const updateStatus = useCallback((currentGame) => {
    let newStatus = '';
    
    if (currentGame.isCheckmate()) {
      newStatus = `Game over, ${currentGame.turn() === 'w' ? 'Black' : 'White'} wins by checkmate.`;
    } else if (currentGame.isDraw()) {
      newStatus = 'Game over, drawn position.';
    } else {
      newStatus = `${currentGame.turn() === 'w' ? 'White' : 'Black'} to move.`;
      if (currentGame.isCheck()) {
        newStatus += ' Check!';
      }
    }
    
    setStatus(newStatus);
  }, []);

  const makeEngineMove = (moveStr) => {
    const gameCopy = new Chess(game.fen());
    try {
      // Move string from stockfish is like e2e4 or e7e8q
      const from = moveStr.substring(0, 2);
      const to = moveStr.substring(2, 4);
      const promotion = moveStr.length > 4 ? moveStr[4] : undefined;
      
      const move = gameCopy.move({ from, to, promotion });
      if (move) {
        setGame(gameCopy);
        setFen(gameCopy.fen());
        updateStatus(gameCopy);
      }
    } catch (e) {
      console.error('Engine move error:', e);
    }
  };

  const askEngineToMove = useCallback(() => {
    if (game.isGameOver() || !engineRef.current) return;
    
    // Set fixed depth based on difficulty to avoid waiting too long
    // Very simple mapping for Phase 1
    const depth = Math.floor(difficulty / 2) + 1;
    
    engineRef.current.postMessage(`position fen ${game.fen()}`);
    engineRef.current.postMessage(`go depth ${depth}`);
  }, [game, difficulty]);

  // When it's black's turn (engine), ask it to move
  useEffect(() => {
    if (game.turn() === 'b' && !game.isGameOver()) {
      setStatus('Computer is thinking...');
      askEngineToMove();
    }
  }, [fen, game, askEngineToMove]);

  function onDrop(sourceSquare, targetSquare, piece) {
    if (game.turn() === 'b') return false; // Prevent moving black pieces

    const gameCopy = new Chess(game.fen());
    
    try {
      // Try to make the move
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: piece[1].toLowerCase() ?? 'q', // Default promotion to queen
      });

      // If invalid, return false
      if (move === null) return false;

      // Valid move
      setGame(gameCopy);
      setFen(gameCopy.fen());
      updateStatus(gameCopy);
      
      return true;
    } catch (e) {
      return false; // Invalid move
    }
  }

  const resetGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setFen(newGame.fen());
    updateStatus(newGame);
  };

  const undoMove = () => {
    const gameCopy = new Chess(game.fen());
    gameCopy.undo(); // Undo engine move
    gameCopy.undo(); // Undo player move
    setGame(gameCopy);
    setFen(gameCopy.fen());
    updateStatus(gameCopy);
  };

  return (
    <div className="app-container">
      <div className="board-container">
        <Chessboard 
          id="BasicBoard" 
          position={fen} 
          onPieceDrop={onDrop}
          boardOrientation="white"
          customDarkSquareStyle={{ backgroundColor: '#475569' }}
          customLightSquareStyle={{ backgroundColor: '#cbd5e1' }}
          animationDuration={200}
        />
      </div>
      
      <div className="panel-container">
        <p className="status-text">{status}</p>
        
        <div className="select-wrapper">
          <label htmlFor="difficulty">Computer Difficulty</label>
          <select 
            id="difficulty" 
            className="difficulty-select"
            value={difficulty} 
            onChange={(e) => setDifficulty(Number(e.target.value))}
          >
            <option value="1">Level 1 (Beginner)</option>
            <option value="5">Level 5 (Amateur)</option>
            <option value="10">Level 10 (Club)</option>
            <option value="15">Level 15 (Master)</option>
            <option value="20">Level 20 (Grandmaster)</option>
          </select>
        </div>

        <button className="btn" onClick={undoMove}>Undo Move</button>
        <button className="btn" onClick={resetGame}>New Game</button>

        <p className="info-text">
          Drag and drop white pieces to play. 
          Stockfish engine will respond as black.
        </p>
      </div>
    </div>
  );
}
