import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export default function ChessGame() {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [status, setStatus] = useState('Your turn to move.');
  const [difficulty, setDifficulty] = useState(5); // 1-20
  
  // Game Review State
  const [moveHistory, setMoveHistory] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  
  // Evaluation State
  const [evaluation, setEvaluation] = useState(0); // in pawns (e.g., 1.5)
  const [evalMate, setEvalMate] = useState(null); // mate in X
  
  const engineRef = useRef(null);
  const gameRef = useRef(game);
  const isLiveRef = useRef(true);

  // Sync refs for engine callback
  useEffect(() => {
    gameRef.current = game;
    isLiveRef.current = currentMoveIndex === moveHistory.length - 1;
  }, [game, currentMoveIndex, moveHistory]);

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

  const makeEngineMove = useCallback((moveStr) => {
    const gameCopy = new Chess(gameRef.current.fen());
    try {
      const from = moveStr.substring(0, 2);
      const to = moveStr.substring(2, 4);
      const promotion = moveStr.length > 4 ? moveStr[4] : undefined;
      
      const move = gameCopy.move({ from, to, promotion });
      if (move) {
        setGame(gameCopy);
        setFen(gameCopy.fen());
        updateStatus(gameCopy);
        
        setMoveHistory(prev => {
          const newHist = [...prev, move];
          setCurrentMoveIndex(newHist.length - 1);
          return newHist;
        });
      }
    } catch (e) {
      console.error('Engine move error:', e);
    }
  }, [updateStatus]);

  // Initialize Engine
  useEffect(() => {
    engineRef.current = new Worker('/stockfish.js');
    
    engineRef.current.onmessage = (event) => {
      const line = event.data;
      if (!line || typeof line !== 'string') return;
      
      // Parse Evaluation
      if (line.startsWith('info ') && line.includes('score ')) {
        const matchCp = line.match(/score cp (-?\d+)/);
        const matchMate = line.match(/score mate (-?\d+)/);
        const isWhite = gameRef.current.turn() === 'w';
        
        if (matchCp) {
          let cp = parseInt(matchCp[1], 10);
          if (!isWhite) cp = -cp;
          setEvaluation(cp / 100);
          setEvalMate(null);
        } else if (matchMate) {
          let mate = parseInt(matchMate[1], 10);
          if (!isWhite) mate = -mate;
          setEvalMate(mate);
        }
      }

      // Handle Engine Move
      if (line.startsWith('bestmove')) {
        if (isLiveRef.current && gameRef.current.turn() === 'b' && !gameRef.current.isGameOver()) {
          const move = line.split(' ')[1];
          if (move && move !== '(none)') {
            makeEngineMove(move);
          }
        }
      }
    };

    engineRef.current.postMessage('uci');
    engineRef.current.postMessage('isready');

    return () => {
      engineRef.current.terminate();
    };
  }, [makeEngineMove]);

  // Update difficulty
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.postMessage(`setoption name Skill Level value ${difficulty}`);
    }
  }, [difficulty]);

  // Trigger evaluation or engine move
  useEffect(() => {
    if (!engineRef.current) return;
    
    engineRef.current.postMessage('stop');
    
    const isLive = currentMoveIndex === moveHistory.length - 1;
    const isBlackTurn = game.turn() === 'b';
    
    engineRef.current.postMessage(`position fen ${game.fen()}`);
    
    if (isLive && isBlackTurn && !game.isGameOver()) {
      setStatus('Computer is thinking...');
      const depth = Math.floor(difficulty / 2) + 1;
      engineRef.current.postMessage(`go depth ${depth}`);
    } else {
      // Static evaluation for review or human turn
      engineRef.current.postMessage('go depth 12');
      updateStatus(game);
    }
  }, [fen, currentMoveIndex, moveHistory.length, difficulty, game, updateStatus]);

  function onDrop(sourceSquare, targetSquare, piece) {
    const isLive = currentMoveIndex === moveHistory.length - 1;
    if (game.turn() === 'b' && isLive) return false;

    const gameCopy = new Chess(game.fen());
    try {
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: piece[1]?.toLowerCase() ?? 'q',
      });

      if (!move) return false;

      setGame(gameCopy);
      setFen(gameCopy.fen());
      updateStatus(gameCopy);
      
      setMoveHistory(prev => {
        const newHist = prev.slice(0, currentMoveIndex + 1);
        newHist.push(move);
        setCurrentMoveIndex(newHist.length - 1);
        return newHist;
      });
      
      return true;
    } catch (e) {
      return false;
    }
  }

  // Navigation functions
  const goToMove = (index) => {
    if (index < -1 || index >= moveHistory.length) return;
    const newGame = new Chess();
    for (let i = 0; i <= index; i++) {
      newGame.move(moveHistory[i]);
    }
    setGame(newGame);
    setFen(newGame.fen());
    setCurrentMoveIndex(index);
  };

  const resetGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setFen(newGame.fen());
    setMoveHistory([]);
    setCurrentMoveIndex(-1);
    setEvaluation(0);
    setEvalMate(null);
    updateStatus(newGame);
  };

  // Evaluation Bar Math
  // Limit eval to [-5, 5] for the visual bar height calculation
  const clampedEval = Math.max(-5, Math.min(5, evaluation));
  const whitePercentage = evalMate !== null 
    ? (evalMate > 0 ? 100 : 0) // White mate => 100%, Black mate => 0%
    : 50 + (clampedEval * 10); // +5 eval => 100%, -5 eval => 0%

  return (
    <div className="app-container">
      {/* Evaluation Bar */}
      <div className="eval-bar-container">
        <div className="eval-bar-fill" style={{ height: `${100 - whitePercentage}%` }} />
        <div className="eval-text">
          {evalMate !== null 
            ? `M${Math.abs(evalMate)}` 
            : (evaluation > 0 ? `+${evaluation.toFixed(1)}` : evaluation.toFixed(1))}
        </div>
      </div>

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
        <p className="status-text">
          {currentMoveIndex !== moveHistory.length - 1 ? (
            <span className="review-badge">Review Mode</span>
          ) : null}
          {' '}{status}
        </p>

        {/* History Navigation */}
        <div className="nav-controls">
          <button className="btn nav-btn" onClick={() => goToMove(-1)} disabled={currentMoveIndex === -1}>|&lt;</button>
          <button className="btn nav-btn" onClick={() => goToMove(currentMoveIndex - 1)} disabled={currentMoveIndex === -1}>&lt;</button>
          <button className="btn nav-btn" onClick={() => goToMove(currentMoveIndex + 1)} disabled={currentMoveIndex === moveHistory.length - 1}>&gt;</button>
          <button className="btn nav-btn" onClick={() => goToMove(moveHistory.length - 1)} disabled={currentMoveIndex === moveHistory.length - 1}>&gt;|</button>
        </div>

        {/* Move History List */}
        <div className="moves-history">
          {moveHistory.length === 0 && <span style={{color: '#64748b'}}>No moves played yet.</span>}
          {moveHistory.reduce((result, move, index) => {
            if (index % 2 === 0) {
              result.push({ w: move, b: null, wIndex: index, bIndex: index + 1 });
            } else {
              result[result.length - 1].b = move;
            }
            return result;
          }, []).map((pair, i) => (
            <div key={i} className="move-row">
              <span className="move-number">{i + 1}.</span>
              <span 
                className={`move-san ${currentMoveIndex === pair.wIndex ? 'active-move' : ''}`}
                onClick={() => goToMove(pair.wIndex)}
              >
                {pair.w.san}
              </span>
              {pair.b && (
                <span 
                  className={`move-san ${currentMoveIndex === pair.bIndex ? 'active-move' : ''}`}
                  onClick={() => goToMove(pair.bIndex)}
                >
                  {pair.b.san}
                </span>
              )}
            </div>
          ))}
        </div>
        
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

        <button className="btn" onClick={resetGame}>New Game</button>

      </div>
    </div>
  );
}
