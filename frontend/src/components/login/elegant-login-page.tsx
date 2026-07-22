'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { getAuthReturnUrl } from '@/lib/auth-return-url';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Loader2, User, Shield, ArrowRight } from 'lucide-react';

// ─── Particle Background ─────────────────────────────────────────
function ParticleCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        class Star {
            x: number; y: number; size: number;
            speedX: number; speedY: number; opacity: number; color: string;
            constructor(w: number, h: number) {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.size = Math.random() * 2 + 0.5;
                this.speedX = (Math.random() - 0.5) * 0.4;
                this.speedY = (Math.random() - 0.5) * 0.4;
                this.opacity = Math.random() * 0.6 + 0.2;
                const colors = ['#60a5fa', '#a78bfa', '#818cf8', '#34d399', '#22d3ee'];
                this.color = colors[Math.floor(Math.random() * colors.length)];
            }
            update(w: number, h: number) {
                this.x += this.speedX;
                this.y += this.speedY;
                if (this.x > w) this.x = 0;
                if (this.x < 0) this.x = w;
                if (this.y > h) this.y = 0;
                if (this.y < 0) this.y = h;
            }
            draw(c: CanvasRenderingContext2D) {
                c.save();
                c.globalAlpha = this.opacity;
                c.fillStyle = this.color;
                c.shadowBlur = 8;
                c.shadowColor = this.color;
                c.beginPath();
                c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                c.fill();
                c.restore();
            }
        }

        const stars: Star[] = [];
        for (let i = 0; i < 80; i++) stars.push(new Star(canvas.width, canvas.height));

        let animId: number;
        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            stars.forEach(s => { s.update(canvas.width, canvas.height); s.draw(ctx); });
            // Draw connections
            for (let i = 0; i < stars.length; i++) {
                for (let j = i + 1; j < stars.length; j++) {
                    const dx = stars[i].x - stars[j].x;
                    const dy = stars[i].y - stars[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.save();
                        ctx.globalAlpha = (1 - dist / 120) * 0.15;
                        ctx.strokeStyle = stars[i].color;
                        ctx.lineWidth = 0.5;
                        ctx.beginPath();
                        ctx.moveTo(stars[i].x, stars[i].y);
                        ctx.lineTo(stars[j].x, stars[j].y);
                        ctx.stroke();
                        ctx.restore();
                    }
                }
            }
            animId = requestAnimationFrame(animate);
        };
        animate();

        return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(animId); };
    }, []);

    return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

// ─── 3D Tilt Card Wrapper ─────────────────────────────────────────
function TiltCard({ children }: { children: React.ReactNode }) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [tilt, setTilt] = useState({ x: 0, y: 0 });

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        setTilt({ x: y * -6, y: x * 6 });
    }, []);

    const handleMouseLeave = useCallback(() => {
        setTilt({ x: 0, y: 0 });
    }, []);

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
                transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                transition: 'transform 0.15s ease-out',
            }}
        >
            {children}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────
export default function ElegantLoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const { login, isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.push(getAuthReturnUrl());
        }
    }, [isAuthenticated, authLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) return;
        setIsLoading(true);
        try {
            await login(username, password);
        } catch (error) {
            // handled by auth context
        } finally {
            setIsLoading(false);
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0e27 0%, #1a1a3e 50%, #0d0221 100%)' }}>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
                    <div className="w-16 h-16 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
                    <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-purple-400/20 border-b-purple-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                </motion.div>
            </div>
        );
    }

    if (isAuthenticated) return null;

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a0e27 0%, #1a1a3e 50%, #0d0221 100%)' }}>
            <ParticleCanvas />

            {/* Ambient light blobs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-1/4 -left-20 w-96 h-96 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', animation: 'blob 8s ease-in-out infinite' }} />
                <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)', animation: 'blob 10s ease-in-out infinite reverse' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 60%)', animation: 'blob 12s ease-in-out infinite' }} />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-md px-4 relative z-10"
            >
                {/* Logo & Title */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.6 }}
                    className="text-center mb-10"
                >
                    {/* Glowing mail icon */}
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5 relative">
                        <div className="absolute inset-0 rounded-2xl opacity-60" style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', filter: 'blur(15px)' }} />
                        <div className="absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }} />
                        <Mail className="h-10 w-10 text-white relative z-10" />
                        {/* Pulse ring */}
                        <div className="absolute inset-0 rounded-2xl animate-ping opacity-20" style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }} />
                    </div>

                    {/* Shimmer title */}
                    <h1 className="text-4xl font-bold mb-2 relative">
                        <span style={{
                            background: 'linear-gradient(90deg, #e2e8f0, #f8fafc, #e2e8f0)',
                            backgroundSize: '200% 100%',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            animation: 'shimmer 3s linear infinite',
                        }}>
                            邮箱管理系统
                        </span>
                    </h1>

                    {/* Subtitle with typing effect */}
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6, duration: 0.8 }}
                        className="text-gray-400 text-sm tracking-widest"
                    >
                        智能化的邮件管理平台
                    </motion.p>
                </motion.div>

                {/* Login Card */}
                <TiltCard>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className="relative rounded-2xl p-[1px]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(59,130,246,0.5), rgba(139,92,246,0.5), rgba(236,72,153,0.3), rgba(59,130,246,0.5))',
                            backgroundSize: '300% 300%',
                            animation: 'gradient-border 6s ease infinite',
                        }}
                    >
                        <div className="rounded-2xl p-8 backdrop-blur-xl" style={{ background: 'rgba(15, 20, 50, 0.85)' }}>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {/* Username */}
                                <motion.div
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.4, duration: 0.5 }}
                                >
                                    <label className="block text-xs font-medium text-gray-400 mb-2 tracking-wider uppercase">
                                        用户名
                                    </label>
                                    <div className="relative group">
                                        <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${focusedField === 'username' ? 'text-blue-400' : 'text-gray-500'}`}>
                                            <User className="h-5 w-5" />
                                        </div>
                                        <input
                                            id="elegant-username"
                                            type="text"
                                            placeholder="请输入用户名"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            onFocus={() => setFocusedField('username')}
                                            onBlur={() => setFocusedField(null)}
                                            disabled={isLoading}
                                            required
                                            className="w-full pl-12 pr-4 py-3.5 rounded-xl border text-white placeholder-gray-500 transition-all duration-300 outline-none text-sm"
                                            style={{
                                                background: 'rgba(255,255,255,0.05)',
                                                borderColor: focusedField === 'username' ? 'rgba(59,130,246,0.6)' : 'rgba(255,255,255,0.08)',
                                                boxShadow: focusedField === 'username' ? '0 0 20px rgba(59,130,246,0.15), inset 0 0 20px rgba(59,130,246,0.05)' : 'none',
                                            }}
                                        />
                                    </div>
                                </motion.div>

                                {/* Password */}
                                <motion.div
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.5, duration: 0.5 }}
                                >
                                    <label className="block text-xs font-medium text-gray-400 mb-2 tracking-wider uppercase">
                                        密码
                                    </label>
                                    <div className="relative group">
                                        <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${focusedField === 'password' ? 'text-purple-400' : 'text-gray-500'}`}>
                                            <Lock className="h-5 w-5" />
                                        </div>
                                        <input
                                            id="elegant-password"
                                            type="password"
                                            placeholder="请输入密码"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            onFocus={() => setFocusedField('password')}
                                            onBlur={() => setFocusedField(null)}
                                            disabled={isLoading}
                                            required
                                            className="w-full pl-12 pr-4 py-3.5 rounded-xl border text-white placeholder-gray-500 transition-all duration-300 outline-none text-sm"
                                            style={{
                                                background: 'rgba(255,255,255,0.05)',
                                                borderColor: focusedField === 'password' ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.08)',
                                                boxShadow: focusedField === 'password' ? '0 0 20px rgba(139,92,246,0.15), inset 0 0 20px rgba(139,92,246,0.05)' : 'none',
                                            }}
                                        />
                                    </div>
                                </motion.div>

                                {/* Login Button */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.6, duration: 0.5 }}
                                >
                                    <motion.button
                                        type="submit"
                                        disabled={isLoading || !username || !password}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="w-full py-3.5 rounded-xl font-medium text-white text-sm relative overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-shadow duration-300 group"
                                        style={{
                                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                            boxShadow: '0 4px 15px rgba(59,130,246,0.3)',
                                        }}
                                    >
                                        {/* Sweep effect */}
                                        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
                                        <span className="relative z-10 flex items-center justify-center gap-2">
                                            {isLoading ? (
                                                <>
                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                    登录中...
                                                </>
                                            ) : (
                                                <>
                                                    安全登录
                                                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                                </>
                                            )}
                                        </span>
                                    </motion.button>
                                </motion.div>
                            </form>

                            {/* Footer inside card */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.8, duration: 0.5 }}
                                className="mt-8 pt-6 border-t border-white/5"
                            >
                                <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                                    <Shield className="h-3.5 w-3.5" />
                                    <span>首次登录的用户将自动注册为管理员</span>
                                </div>
                            </motion.div>
                        </div>
                    </motion.div>
                </TiltCard>

                {/* Copyright */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1, duration: 0.5 }}
                    className="mt-8 text-center text-xs text-gray-600"
                >
                    © 2025 邮箱管理系统. All rights reserved.
                </motion.div>
            </motion.div>
        </div>
    );
}
