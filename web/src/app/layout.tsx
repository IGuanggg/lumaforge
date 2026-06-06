import type { Metadata } from "next";
import Script from "next/script";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/components/layout/app-providers";
import "antd/dist/reset.css";
import "./globals.css";
import React from "react";

export const metadata: Metadata = {
    title: "LumaForge 光绘工坊",
    description: "本地优先的 AI 创作工作台",
};

const mutationObserverGuardScript = `(function(){try{window.addEventListener("error",function(event){var message=String(event&&event.message||"");if(/Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'/i.test(message)){event.preventDefault();return true}},true);if(!window.MutationObserver||window.__lumaforgeMutationObserverGuard)return;window.__lumaforgeMutationObserverGuard=true;var OriginalMutationObserver=window.MutationObserver;window.MutationObserver=function(callback){var observer=new OriginalMutationObserver(callback);var originalObserve=observer.observe;observer.observe=function(target,options){if(!target||typeof target.nodeType!=="number")return;try{return originalObserve.call(observer,target,options)}catch(err){if(err&&/parameter 1 is not of type 'Node'/i.test(String(err.message||err)))return;throw err}};return observer};window.MutationObserver.prototype=OriginalMutationObserver.prototype}catch(e){}})();`;

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN" suppressHydrationWarning className="font-sans">
            <head>
                <script id="mutation-observer-guard-inline" dangerouslySetInnerHTML={{ __html: mutationObserverGuardScript }} />
            </head>
            <body
                className="bg-background text-foreground antialiased"
                style={{
                    fontFamily: '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
                }}
            >
                <Script
                    id="theme-script"
                    strategy="beforeInteractive"
                    dangerouslySetInnerHTML={{
                        __html: `try{var s=JSON.parse(localStorage.getItem("infinite-canvas:theme_store")||"{}");var t=s.state&&s.state.theme==="light"?"light":"dark";document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t}catch(e){}`,
                    }}
                />
                <AntdRegistry>
                    <AppProviders>{children}</AppProviders>
                </AntdRegistry>
            </body>
        </html>
    );
}
