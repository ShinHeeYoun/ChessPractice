import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { masterGames } from '../data/masterGames';

export default function ChessGame() {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [status, setStatus] = useState('Your turn to move.');
  const [difficulty, setDifficulty] = useState(5); // 1-20
  
  // Game Review State
  const [moveHistory, setMoveHistory] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  
  // Click to move state
  const [moveFrom, setMoveFrom] = useState(null);
  const [optionSquares, setOptionSquares] = useState({});
  
  // Evaluation State
  const [evaluation, setEvaluation] = useState(0); // in pawns (e.g., 1.5)
  const [evalMate, setEvalMate] = useState(null); // mate in X
  
  const engineRef = useRef(null);
  const gameRef = useRef(game);
  const isLiveRef = useRef(true);
  const currentMoveIndexRef = useRef(currentMoveIndex);
  
  // The evaluation before a move was made (used for delta calculation)
  const prevEvalRef = useRef({ evaluation: 0, evalMate: null });

  // Sync refs for engine callback
  useEffect(() => {
    gameRef.current = game;
    isLiveRef.current = currentMoveIndex === moveHistory.length - 1;
    currentMoveIndexRef.current = currentMoveIndex;
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
        const beforeEval = { ...prevEvalRef.current };
        
        setGame(gameCopy);
        setFen(gameCopy.fen());
        updateStatus(gameCopy);
        
        setMoveHistory(prev => {
          const newHist = [...prev, { ...move, beforeEval }];
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
    engineRef.current = new Worker(import.meta.env.BASE_URL + 'stockfish.js');
    
    engineRef.current.onmessage = (event) => {
      const line = event.data;
      if (!line || typeof line !== 'string') return;
      
      // Parse Evaluation
      if (line.startsWith('info ') && line.includes('score ')) {
        const matchCp = line.match(/score cp (-?\d+)/);
        const matchMate = line.match(/score mate (-?\d+)/);
        const matchDepth = line.match(/depth (\d+)/);
        const depth = matchDepth ? parseInt(matchDepth[1], 10) : 0;
        const isWhite = gameRef.current.turn() === 'w';
        
        let cp = 0;
        let mate = null;
        
        if (matchCp) {
          cp = parseInt(matchCp[1], 10);
          if (!isWhite) cp = -cp;
          setEvaluation(cp / 100);
          setEvalMate(null);
          prevEvalRef.current = { evaluation: cp / 100, evalMate: null };
        } else if (matchMate) {
          mate = parseInt(matchMate[1], 10);
          if (!isWhite) mate = -mate;
          setEvalMate(mate);
          prevEvalRef.current = { evaluation: 0, evalMate: mate };
        }

        // Live Classification Logic
        if (depth >= 8) {
          setMoveHistory(prev => {
            const idx = currentMoveIndexRef.current;
            if (idx >= 0 && idx < prev.length) {
              const move = prev[idx];
              if (!move.evalDepth || move.evalDepth < depth) {
                if (move.beforeEval) {
                  const e1 = move.beforeEval.evalMate !== null 
                    ? Math.sign(move.beforeEval.evalMate) * 100 
                    : move.beforeEval.evaluation;
                    
                  const e2 = mate !== null 
                    ? Math.sign(mate) * 100 
                    : (cp / 100);
                  
                  const delta = move.color === 'w' ? (e2 - e1) : (e1 - e2);
                  
                  let cls = 'excellent'; // default for acceptable moves
                  if (delta <= -2.0) cls = 'blunder';
                  else if (delta <= -1.0) cls = 'mistake';
                  else if (delta <= -0.5) cls = 'inaccuracy';
                  else if (delta >= 0.5) cls = 'great';
                  
                  const newHist = [...prev];
                  newHist[idx] = { ...move, classification: cls, evalDepth: depth, delta };
                  return newHist;
                }
              }
            }
            return prev;
          });
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
        promotion: 'q',
      });

      if (!move) return false;

      const beforeEval = { ...prevEvalRef.current };

      setGame(gameCopy);
      setFen(gameCopy.fen());
      updateStatus(gameCopy);
      
      setMoveHistory(prev => {
        const newHist = prev.slice(0, currentMoveIndex + 1);
        newHist.push({ ...move, beforeEval });
        setCurrentMoveIndex(newHist.length - 1);
        return newHist;
      });
      
      setMoveFrom(null);
      setOptionSquares({});
      return true;
    } catch (e) {
      return false;
    }
  }

  function getMoveOptions(square) {
    const moves = game.moves({
      square,
      verbose: true
    });
    if (moves.length === 0) {
      setOptionSquares({});
      return false;
    }

    const newSquares = {};
    moves.map((move) => {
      newSquares[move.to] = {
        background:
          game.get(move.to) && game.get(move.to).color !== game.get(square).color
            ? 'radial-gradient(transparent 0%, transparent 80%, rgba(0,0,0,0.3) 80%)'
            : 'radial-gradient(circle, rgba(0,0,0,.3) 25%, transparent 25%)',
        borderRadius: '50%'
      };
      return move;
    });
    newSquares[square] = {
      background: 'rgba(234, 179, 8, 0.4)'
    };
    setOptionSquares(newSquares);
    return true;
  }

  function onSquareClick(square) {
    const isLive = currentMoveIndex === moveHistory.length - 1;
    if (game.turn() === 'b' && isLive) return;

    // First click: select piece
    if (!moveFrom) {
      const hasMoveOptions = getMoveOptions(square);
      if (hasMoveOptions) setMoveFrom(square);
      return;
    }

    // Second click: attempt to move
    const gameCopy = new Chess(game.fen());
    try {
      const move = gameCopy.move({
        from: moveFrom,
        to: square,
        promotion: 'q'
      });

      if (move) {
        const beforeEval = { ...prevEvalRef.current };
        setGame(gameCopy);
        setFen(gameCopy.fen());
        updateStatus(gameCopy);
        
        setMoveHistory(prev => {
          const newHist = prev.slice(0, currentMoveIndex + 1);
          newHist.push({ ...move, beforeEval });
          setCurrentMoveIndex(newHist.length - 1);
          return newHist;
        });
        setMoveFrom(null);
        setOptionSquares({});
      } else {
        // If clicked on invalid square, check if it's our own piece to select it instead
        if (game.get(square) && game.get(square).color === game.turn()) {
          const hasMoveOptions = getMoveOptions(square);
          if (hasMoveOptions) setMoveFrom(square);
        } else {
          setMoveFrom(null);
          setOptionSquares({});
        }
      }
    } catch (e) {
      // Invalid move exception
      if (game.get(square) && game.get(square).color === game.turn()) {
        const hasMoveOptions = getMoveOptions(square);
        if (hasMoveOptions) setMoveFrom(square);
      } else {
        setMoveFrom(null);
        setOptionSquares({});
      }
    }
  }

  function onSquareRightClick(square) {
    setMoveFrom(null);
    setOptionSquares({});
  }

  // Navigation functions
  const goToMove = (index) => {
    if (index < -1 || index >= moveHistory.length) return;
    
    setMoveHistory(prev => {
      const newHist = [...prev];
      // Inject beforeEval if stepping forward exactly one move in a loaded game
      if (index === currentMoveIndex + 1 && !newHist[index].beforeEval) {
        newHist[index] = { ...newHist[index], beforeEval: { ...prevEvalRef.current } };
      }
      return newHist;
    });

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
    prevEvalRef.current = { evaluation: 0, evalMate: null };
    setMoveFrom(null);
    setOptionSquares({});
    updateStatus(newGame);
  };

  const loadMasterGame = (e) => {
    const gameId = parseInt(e.target.value, 10);
    if (isNaN(gameId)) return;
    
    const selectedGame = masterGames.find(g => g.id === gameId);
    if (!selectedGame) return;

    const newGame = new Chess();
    newGame.loadPgn(selectedGame.pgn);
    
    const historyMoves = newGame.history({ verbose: true });
    const startGame = new Chess();
    
    setGame(startGame);
    setFen(startGame.fen());
    
    const formattedHistory = historyMoves.map(move => ({
      ...move,
      color: move.color,
    }));
    
    setMoveHistory(formattedHistory);
    setCurrentMoveIndex(-1);
    setEvaluation(0);
    setEvalMate(null);
    prevEvalRef.current = { evaluation: 0, evalMate: null };
    setMoveFrom(null);
    setOptionSquares({});
    updateStatus(startGame);
  };

  // Evaluation Bar Math
  const clampedEval = Math.max(-5, Math.min(5, evaluation));
  const whitePercentage = evalMate !== null 
    ? (evalMate > 0 ? 100 : 0) 
    : 50 + (clampedEval * 10); 

  // Custom Square Styles based on Move Classification
  const getCustomSquareStyles = () => {
    let styles = { ...optionSquares };

    if (currentMoveIndex < 0 || currentMoveIndex >= moveHistory.length) return styles;
    
    const move = moveHistory[currentMoveIndex];
    if (!move) return styles;
    
    // Default highlight for last move
    styles[move.from] = { ...(styles[move.from] || {}), backgroundColor: 'rgba(234, 179, 8, 0.3)' };
    styles[move.to] = { ...(styles[move.to] || {}), backgroundColor: 'rgba(234, 179, 8, 0.4)' };
    
    if (move.classification) {
      const colorMap = {
        blunder: 'rgba(239, 68, 68, 0.85)',     // Red
        mistake: 'rgba(249, 115, 22, 0.85)',     // Orange
        inaccuracy: 'rgba(234, 179, 8, 0.85)',   // Yellow
        excellent: 'rgba(34, 197, 94, 0.85)',    // Green
        great: 'rgba(14, 165, 233, 0.85)'        // Blue
      };
      
      const color = colorMap[move.classification];
      if (color) {
        styles[move.to] = {
          ...styles[move.to],
          backgroundColor: color,
          borderRadius: '4px',
          boxShadow: `inset 0 0 15px rgba(0,0,0,0.5)`
        };
      }
    }
    
    return styles;
  };

  const renderMoveAnnotation = (classification) => {
    if (!classification) return null;
    switch(classification) {
      case 'blunder': return <span className="cls-blunder">??</span>;
      case 'mistake': return <span className="cls-mistake">?</span>;
      case 'inaccuracy': return <span className="cls-inacc">?!</span>;
      case 'great': return <span className="cls-great">!</span>;
      case 'excellent': return <span className="cls-excel">★</span>;
      default: return null;
    }
  };

  return (
    <div className="app-container">
      
      <div className="board-wrapper">
        {/* Horizontal Evaluation Bar */}
        <div className="eval-bar-container">
          <div className="eval-bar-fill" style={{ width: `${100 - whitePercentage}%` }} />
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
            onSquareClick={onSquareClick}
            onSquareRightClick={onSquareRightClick}
            boardOrientation="white"
            customDarkSquareStyle={{ backgroundColor: '#334155' }}
            customLightSquareStyle={{ backgroundColor: '#cbd5e1' }}
            customSquareStyles={getCustomSquareStyles()}
            animationDuration={200}
          />
        </div>
      </div>
      
      <div className="panel-container">
        <p className="status-text">
          {currentMoveIndex !== moveHistory.length - 1 ? (
            <span className="review-badge">Review</span>
          ) : null}
          {status}
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
                {renderMoveAnnotation(pair.w.classification)}
              </span>
              {pair.b && (
                <span 
                  className={`move-san ${currentMoveIndex === pair.bIndex ? 'active-move' : ''}`}
                  onClick={() => goToMove(pair.bIndex)}
                >
                  {pair.b.san}
                  {renderMoveAnnotation(pair.b.classification)}
                </span>
              )}
            </div>
          ))}
        </div>
        
        <div className="select-wrapper">
          <label htmlFor="masterGame">Watch Master Game</label>
          <select 
            id="masterGame" 
            className="difficulty-select"
            defaultValue=""
            onChange={loadMasterGame}
          >
            <option value="" disabled>Select a Game...</option>
            {masterGames.map(g => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
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
