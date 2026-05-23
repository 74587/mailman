'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { motion, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import { Loader2, User, Lock, Shield, Eye, EyeOff } from 'lucide-react';

// ─── Character SVG Component ─────────────────────────────────────
interface CharacterProps {
    color: string;
    eyeColor?: string;
    size: number;
    focusedField: 'none' | 'username' | 'password';
    usernameLength: number;
    loginStatus: 'idle' | 'success' | 'error';
    index: number;
}

function Character({ color, eyeColor = '#1a1a2e', size, focusedField, usernameLength, loginStatus, index }: CharacterProps) {
    // Eye tracking — pupils follow the text length
    const maxEyeMove = 4;
    const eyeOffsetX = useMemo(() => {
        if (focusedField === 'username') {
            const normalized = Math.min(usernameLength / 20, 1);
            return (normalized - 0.5) * maxEyeMove * 2;
        }
        return 0;
    }, [focusedField, usernameLength]);

    const eyeOffsetY = focusedField === 'username' ? 2 : 0;

    // Whether covering eyes
    const isCovering = focusedField === 'password';
    const isHappy = loginStatus === 'success';
    const isWorried = loginStatus === 'error';

    // Stagger delays per character
    const delay = index * 0.08;

    // Bounce for idle
    const bounceY = useSpring(0, { stiffness: 300, damping: 20 });
    useEffect(() => {
        if (isHappy) {
            bounceY.set(-15);
            const t = setTimeout(() => bounceY.set(0), 400);
            return () => clearTimeout(t);
        }
    }, [isHappy, bounceY]);

    // Arms covering animation
    const leftArmRotate = useSpring(0, { stiffness: 200, damping: 15 });
    const rightArmRotate = useSpring(0, { stiffness: 200, damping: 15 });

    useEffect(() => {
        if (isCovering) {
            if (index === 0) {
                leftArmRotate.set(-140);
                rightArmRotate.set(140);
            } else if (index === 1) {
                leftArmRotate.set(-150);
                rightArmRotate.set(130);
            } else {
                leftArmRotate.set(-130);
                rightArmRotate.set(150);
            }
        } else {
            leftArmRotate.set(0);
            rightArmRotate.set(0);
        }
    }, [isCovering, index, leftArmRotate, rightArmRotate]);

    const leftArmR = useTransform(leftArmRotate, v => `rotate(${v}deg)`);
    const rightArmR = useTransform(rightArmRotate, v => `rotate(${v}deg)`);
    const yOffset = useTransform(bounceY, v => v);

    // Blink state
    const [isBlinking, setIsBlinking] = useState(false);
    useEffect(() => {
        const blinkInterval = setInterval(() => {
            setIsBlinking(true);
            setTimeout(() => setIsBlinking(false), 150);
        }, 3000 + index * 1000);
        return () => clearInterval(blinkInterval);
    }, [index]);

    const headR = size * 0.4;
    const cx = size / 2;

    return (
        <motion.div
            style={{ y: yOffset, width: size, height: size }}
            animate={isWorried ? { x: [0, -3, 3, -2, 2, 0] } : {}}
            transition={isWorried ? { duration: 0.4 } : {}}
        >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {/* Body / Torso peeking behind wall */}
                <ellipse
                    cx={cx}
                    cy={size * 0.85}
                    rx={size * 0.3}
                    ry={size * 0.18}
                    fill={color}
                    opacity={0.6}
                />

                {/* Head */}
                <motion.circle
                    cx={cx}
                    cy={size * 0.42}
                    r={headR}
                    fill={color}
                    animate={{
                        cy: focusedField === 'username' ? size * 0.38 : size * 0.42,
                    }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15, delay }}
                />

                {/* Cheeks (blush) */}
                <circle cx={cx - headR * 0.55} cy={size * 0.5} r={headR * 0.15} fill="#ff9999" opacity={0.4} />
                <circle cx={cx + headR * 0.55} cy={size * 0.5} r={headR * 0.15} fill="#ff9999" opacity={0.4} />

                {/* Eyes */}
                {!isCovering && !isHappy && (
                    <>
                        {/* Left eye */}
                        <ellipse
                            cx={cx - headR * 0.3}
                            cy={size * 0.4}
                            rx={headR * 0.18}
                            ry={isBlinking ? headR * 0.03 : headR * (isWorried ? 0.22 : 0.16)}
                            fill="white"
                        />
                        <motion.circle
                            cx={cx - headR * 0.3 + eyeOffsetX}
                            cy={size * 0.4 + eyeOffsetY}
                            r={headR * (isWorried ? 0.12 : 0.09)}
                            fill={eyeColor}
                            animate={{ cx: cx - headR * 0.3 + eyeOffsetX }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        />

                        {/* Right eye */}
                        <ellipse
                            cx={cx + headR * 0.3}
                            cy={size * 0.4}
                            rx={headR * 0.18}
                            ry={isBlinking ? headR * 0.03 : headR * (isWorried ? 0.22 : 0.16)}
                            fill="white"
                        />
                        <motion.circle
                            cx={cx + headR * 0.3 + eyeOffsetX}
                            cy={size * 0.4 + eyeOffsetY}
                            r={headR * (isWorried ? 0.12 : 0.09)}
                            fill={eyeColor}
                            animate={{ cx: cx + headR * 0.3 + eyeOffsetX }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        />
                    </>
                )}

                {/* Happy eyes (^  ^) */}
                {isHappy && !isCovering && (
                    <>
                        <path
                            d={`M${cx - headR * 0.45} ${size * 0.42} Q${cx - headR * 0.3} ${size * 0.35} ${cx - headR * 0.15} ${size * 0.42}`}
                            fill="none" stroke={eyeColor} strokeWidth={2.5} strokeLinecap="round"
                        />
                        <path
                            d={`M${cx + headR * 0.15} ${size * 0.42} Q${cx + headR * 0.3} ${size * 0.35} ${cx + headR * 0.45} ${size * 0.42}`}
                            fill="none" stroke={eyeColor} strokeWidth={2.5} strokeLinecap="round"
                        />
                    </>
                )}

                {/* Mouth */}
                {isHappy ? (
                    <path
                        d={`M${cx - headR * 0.25} ${size * 0.5} Q${cx} ${size * 0.58} ${cx + headR * 0.25} ${size * 0.5}`}
                        fill="none" stroke={eyeColor} strokeWidth={2} strokeLinecap="round"
                    />
                ) : isWorried ? (
                    <path
                        d={`M${cx - headR * 0.15} ${size * 0.54} Q${cx} ${size * 0.5} ${cx + headR * 0.15} ${size * 0.54}`}
                        fill="none" stroke={eyeColor} strokeWidth={2} strokeLinecap="round"
                    />
                ) : (
                    <path
                        d={`M${cx - headR * 0.2} ${size * 0.52} Q${cx} ${size * 0.56} ${cx + headR * 0.2} ${size * 0.52}`}
                        fill="none" stroke={eyeColor} strokeWidth={1.5} strokeLinecap="round"
                    />
                )}

                {/* Left arm */}
                <motion.g style={{ transformOrigin: `${cx - headR * 0.6}px ${size * 0.65}px`, rotate: leftArmR }}>
                    <rect
                        x={cx - headR * 0.6 - 6}
                        y={size * 0.62}
                        width={12}
                        height={headR * 0.8}
                        rx={6}
                        fill={color}
                        style={{ filter: 'brightness(0.9)' }}
                    />
                    {/* Hand */}
                    <circle cx={cx - headR * 0.6} cy={size * 0.62 + headR * 0.8} r={7} fill={color} style={{ filter: 'brightness(0.85)' }} />
                </motion.g>

                {/* Right arm */}
                <motion.g style={{ transformOrigin: `${cx + headR * 0.6}px ${size * 0.65}px`, rotate: rightArmR }}>
                    <rect
                        x={cx + headR * 0.6 - 6}
                        y={size * 0.62}
                        width={12}
                        height={headR * 0.8}
                        rx={6}
                        fill={color}
                        style={{ filter: 'brightness(0.9)' }}
                    />
                    {/* Hand */}
                    <circle cx={cx + headR * 0.6} cy={size * 0.62 + headR * 0.8} r={7} fill={color} style={{ filter: 'brightness(0.85)' }} />
                </motion.g>
            </svg>
        </motion.div>
    );
}

// ─── Floating Cloud ──────────────────────────────────────────────
function Cloud({ top, delay, duration, size }: { top: string; delay: number; duration: number; size: number }) {
    return (
        <div
            className="absolute pointer-events-none"
            style={{
                top,
                right: '-200px',
                animation: `cloud-float ${duration}s linear ${delay}s infinite`,
                opacity: 0.25,
            }}
        >
            <svg width={size} height={size * 0.5} viewBox="0 0 200 100">
                <ellipse cx="60" cy="70" rx="50" ry="25" fill="white" />
                <ellipse cx="100" cy="55" rx="45" ry="30" fill="white" />
                <ellipse cx="140" cy="70" rx="40" ry="22" fill="white" />
                <ellipse cx="100" cy="70" rx="60" ry="20" fill="white" />
            </svg>
        </div>
    );
}

// ─── Sparkle ─────────────────────────────────────────────────────
function Sparkle({ x, y, delay }: { x: number; y: number; delay: number }) {
    return (
        <motion.div
            className="absolute pointer-events-none"
            style={{ left: x, top: y }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0] }}
            transition={{ duration: 0.6, delay, repeat: Infinity, repeatDelay: 2 }}
        >
            <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5Z" fill="#FFD700" opacity={0.7} />
            </svg>
        </motion.div>
    );
}

// ─── Main Component ──────────────────────────────────────────────
export default function PlayfulLoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [focusedField, setFocusedField] = useState<'none' | 'username' | 'password'>('none');
    const [loginStatus, setLoginStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const { login, isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.push('/main');
        }
    }, [isAuthenticated, authLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) return;
        setIsLoading(true);
        setLoginStatus('idle');
        try {
            await login(username, password);
            setLoginStatus('success');
        } catch (error) {
            setLoginStatus('error');
            setTimeout(() => setLoginStatus('idle'), 1500);
        } finally {
            setIsLoading(false);
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF8DC 0%, #FFECD2 50%, #E8E0F0 100%)' }}>
                <div className="flex gap-2">
                    {[0, 1, 2].map(i => (
                        <motion.div
                            key={i}
                            className="w-4 h-4 rounded-full"
                            style={{ background: ['#FF9A76', '#FFBC80', '#FFD59E'][i] }}
                            animate={{ y: [0, -15, 0] }}
                            transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    if (isAuthenticated) return null;

    const characters = [
        { color: '#FFB6C1', size: 90 },
        { color: '#87CEEB', size: 100 },
        { color: '#98FB98', size: 85 },
    ];

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #FFF8DC 0%, #FFECD2 50%, #E8E0F0 100%)' }}>
            {/* Floating clouds */}
            <Cloud top="10%" delay={0} duration={25} size={180} />
            <Cloud top="25%" delay={8} duration={30} size={140} />
            <Cloud top="60%" delay={15} duration={28} size={160} />

            {/* Floating decorations */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {/* Hearts */}
                {[
                    { x: '10%', y: '20%', delay: 0 },
                    { x: '85%', y: '15%', delay: 2 },
                    { x: '75%', y: '70%', delay: 4 },
                    { x: '15%', y: '75%', delay: 6 },
                ].map((h, i) => (
                    <motion.div
                        key={i}
                        className="absolute text-2xl"
                        style={{ left: h.x, top: h.y }}
                        animate={{ y: [0, -10, 0], opacity: [0.3, 0.6, 0.3] }}
                        transition={{ duration: 3, delay: h.delay, repeat: Infinity }}
                    >
                        💕
                    </motion.div>
                ))}
                {/* Stars */}
                {[
                    { x: '20%', y: '30%', delay: 1 },
                    { x: '80%', y: '40%', delay: 3 },
                    { x: '50%', y: '10%', delay: 5 },
                ].map((s, i) => (
                    <motion.div
                        key={i}
                        className="absolute text-xl"
                        style={{ left: s.x, top: s.y }}
                        animate={{ rotate: [0, 360], opacity: [0.2, 0.5, 0.2] }}
                        transition={{ duration: 4, delay: s.delay, repeat: Infinity }}
                    >
                        ⭐
                    </motion.div>
                ))}
            </div>

            <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-md px-4 relative z-10"
            >
                {/* Title */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                    className="text-center mb-4"
                >
                    <h1 className="text-3xl font-bold" style={{ color: '#2D3436' }}>
                        <span className="inline-block" style={{ animation: 'wiggle 2s ease-in-out infinite' }}>📬</span>
                        {' '}邮箱管理系统
                    </h1>
                    <p className="text-sm mt-1" style={{ color: '#636e72' }}>
                        可爱又安全的邮件管理平台
                    </p>
                </motion.div>

                {/* Characters sitting on top of card */}
                <div className="relative">
                    {/* Character container — positioned above the card */}
                    <div className="flex items-end justify-center gap-2 relative z-20" style={{ marginBottom: '-30px' }}>
                        {characters.map((char, i) => (
                            <motion.div
                                key={i}
                                initial={{ y: 30, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 + i * 0.15, type: 'spring', stiffness: 200 }}
                            >
                                <Character
                                    color={char.color}
                                    size={char.size}
                                    focusedField={focusedField}
                                    usernameLength={username.length}
                                    loginStatus={loginStatus}
                                    index={i}
                                />
                            </motion.div>
                        ))}

                        {/* Success sparkles */}
                        <AnimatePresence>
                            {loginStatus === 'success' && (
                                <>
                                    <Sparkle x={30} y={-10} delay={0} />
                                    <Sparkle x={120} y={-20} delay={0.1} />
                                    <Sparkle x={210} y={-5} delay={0.2} />
                                    <Sparkle x={80} y={-30} delay={0.3} />
                                    <Sparkle x={170} y={-25} delay={0.15} />
                                </>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Login Card — the "wall" characters sit on */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.6 }}
                        className="relative z-10 rounded-3xl p-8 pt-12"
                        style={{
                            background: 'rgba(255, 255, 255, 0.92)',
                            backdropFilter: 'blur(20px)',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.08), 0 4px 20px rgba(0,0,0,0.04)',
                            border: '1px solid rgba(255,255,255,0.8)',
                        }}
                    >
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* Username */}
                            <div>
                                <label className="block text-sm font-medium mb-1.5" style={{ color: '#2D3436' }}>
                                    用户名
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: focusedField === 'username' ? '#FF9A76' : '#b2bec3' }} />
                                    <input
                                        id="playful-username"
                                        type="text"
                                        placeholder="请输入用户名"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onFocus={() => setFocusedField('username')}
                                        onBlur={() => setFocusedField('none')}
                                        disabled={isLoading}
                                        required
                                        className="w-full pl-11 pr-4 py-3 rounded-2xl text-sm outline-none transition-all duration-300"
                                        style={{
                                            background: focusedField === 'username' ? '#FFF5F0' : '#F8F9FA',
                                            border: `2px solid ${focusedField === 'username' ? '#FF9A76' : '#eee'}`,
                                            boxShadow: focusedField === 'username' ? '0 0 0 4px rgba(255,154,118,0.15)' : 'none',
                                            color: '#2D3436',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="block text-sm font-medium mb-1.5" style={{ color: '#2D3436' }}>
                                    密码
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: focusedField === 'password' ? '#a29bfe' : '#b2bec3' }} />
                                    <input
                                        id="playful-password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="请输入密码（小人会遮眼哦 👀）"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField('none')}
                                        disabled={isLoading}
                                        required
                                        className="w-full pl-11 pr-12 py-3 rounded-2xl text-sm outline-none transition-all duration-300"
                                        style={{
                                            background: focusedField === 'password' ? '#F0EFFF' : '#F8F9FA',
                                            border: `2px solid ${focusedField === 'password' ? '#a29bfe' : '#eee'}`,
                                            boxShadow: focusedField === 'password' ? '0 0 0 4px rgba(162,155,254,0.15)' : 'none',
                                            color: '#2D3436',
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100 transition-colors"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-4 w-4" style={{ color: '#b2bec3' }} />
                                        ) : (
                                            <Eye className="h-4 w-4" style={{ color: '#b2bec3' }} />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Login Button */}
                            <motion.button
                                type="submit"
                                disabled={isLoading || !username || !password}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.97 }}
                                className="w-full py-3.5 rounded-2xl font-medium text-white text-sm relative overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{
                                    background: 'linear-gradient(135deg, #FF9A76 0%, #FFBC80 50%, #f0932b 100%)',
                                    boxShadow: '0 4px 15px rgba(255,154,118,0.4)',
                                }}
                            >
                                {/* Shine sweep */}
                                <span
                                    className="absolute inset-0 -skew-x-12"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                                        animation: 'btn-sweep 3s ease-in-out infinite',
                                    }}
                                />
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            登录中...
                                        </>
                                    ) : (
                                        <>
                                            开始冒险 🚀
                                        </>
                                    )}
                                </span>
                            </motion.button>
                        </form>

                        {/* Footer */}
                        <div className="mt-6 pt-5 border-t" style={{ borderColor: '#f0f0f0' }}>
                            <div className="flex items-center justify-center gap-2 text-xs" style={{ color: '#b2bec3' }}>
                                <Shield className="h-3.5 w-3.5" />
                                <span>首次登录的用户将自动注册为管理员</span>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Copyright */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="mt-6 text-center text-xs"
                    style={{ color: '#b2bec3' }}
                >
                    © 2025 邮箱管理系统. All rights reserved.
                </motion.div>
            </motion.div>

            {/* Keyframe animations */}
            <style jsx global>{`
                @keyframes cloud-float {
                    0% { transform: translateX(calc(100vw + 200px)); }
                    100% { transform: translateX(-400px); }
                }
                @keyframes wiggle {
                    0%, 100% { transform: rotate(0deg); }
                    25% { transform: rotate(-5deg); }
                    75% { transform: rotate(5deg); }
                }
                @keyframes btn-sweep {
                    0% { transform: translateX(-200%) skewX(-12deg); }
                    50% { transform: translateX(200%) skewX(-12deg); }
                    100% { transform: translateX(200%) skewX(-12deg); }
                }
            `}</style>
        </div>
    );
}
