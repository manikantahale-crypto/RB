import React from 'react';
import { Mail, Phone, MapPin, Linkedin, FileText, Globe, Github } from 'lucide-react';

export const TemplateDesign = ({ templateId }: { templateId: number }) => {
  if (templateId === 1) {
    // Modern Professional
    return (
      <div className="p-12 space-y-6 font-sans relative w-full h-full text-slate-800 text-left bg-white box-border">
        <div className="flex justify-between items-start border-b border-slate-300 pb-6">
          <div>
            <h1 className="text-4xl font-bold uppercase tracking-tight flex gap-2">ALEX <span className="text-[#3b82f6]">JOHNSON</span></h1>
            <p className="text-[#3b82f6] font-semibold mt-1 text-[15px]">Senior Java Developer</p>
          </div>
          <div className="text-right text-[13px] text-slate-700 space-y-2 flex flex-col items-end pt-1">
            <div className="flex items-center gap-2 font-medium"><Mail className="w-4 h-4 text-slate-900" fill="currentColor" /> alex.johnson@email.com</div>
            <div className="flex items-center gap-2 font-medium"><Phone className="w-4 h-4 text-slate-900" fill="currentColor" /> +1 (555) 123-4567</div>
            <div className="flex items-center gap-2 font-medium"><MapPin className="w-4 h-4 text-slate-900" fill="currentColor" /> Dallas, TX</div>
            <div className="flex items-center gap-2 font-medium"><Linkedin className="w-4 h-4 text-slate-900" fill="currentColor" /> linkedin.com/in/alexjohnson</div>
          </div>
        </div>
        
        <div>
          <h2 className="text-sm font-bold uppercase text-[#3b82f6] mb-3 tracking-wider">Professional Summary</h2>
          <p className="text-[13px] text-slate-700 leading-relaxed font-medium">Results-driven Senior Java Developer with 7+ years of experience in designing, developing, and delivering scalable enterprise applications. Expertise in Java, Spring Boot, Microservices, AWS, and modern software development practices. Strong track record of improving application performance and leading agile teams to successful project deliveries.</p>
        </div>
        
        <div className="border-t border-slate-200 pt-5">
          <h2 className="text-sm font-bold uppercase text-[#3b82f6] mb-4 tracking-wider">Technical Skills</h2>
          <ul className="text-[13px] text-slate-700 space-y-2 list-disc pl-5">
            <li><span className="font-bold text-slate-900">Languages:</span> Java (8-17), Python, SQL, JavaScript, TypeScript</li>
            <li><span className="font-bold text-slate-900">Frameworks:</span> Spring Boot, Spring Cloud, Hibernate, React, Node.js</li>
            <li><span className="font-bold text-slate-900">Databases:</span> MySQL, PostgreSQL, MongoDB, Redis, Oracle</li>
            <li><span className="font-bold text-slate-900">Cloud & DevOps:</span> AWS (EC2, S3, RDS, Lambda), Docker, Kubernetes, Jenkins, CI/CD</li>
            <li><span className="font-bold text-slate-900">Tools:</span> Git, Maven, Gradle, IntelliJ, Postman, Jira, Confluence</li>
          </ul>
        </div>
        
        <div className="border-t border-slate-200 pt-5">
          <h2 className="text-sm font-bold uppercase text-[#3b82f6] mb-4 tracking-wider">Experience</h2>
          
          <div className="mb-6">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">TechTalent Inc.</h3>
                <p className="text-[#3b82f6] text-[13px] font-semibold">Senior Java Developer</p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-bold text-slate-900">Jun 2021 - Present</p>
                <p className="text-[13px] text-slate-900">Dallas, TX</p>
              </div>
            </div>
            <ul className="list-disc pl-5 text-[13px] text-slate-700 space-y-2 mt-2 font-medium">
              <li>Designed and developed highly scalable microservices using Spring Boot and Java 17.</li>
              <li>Implemented RESTful APIs and integrated with multiple external payment gateways.</li>
              <li>Improved application performance by 30% through database query optimization and caching mechanisms.</li>
              <li>Mentored junior developers, conducted code reviews, and enforced best coding practices.</li>
              <li>Led the migration of legacy monolith applications to an AWS-hosted Kubernetes cluster.</li>
            </ul>
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Quantum Data Systems</h3>
                <p className="text-[#3b82f6] text-[13px] font-semibold">Java Developer</p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-bold text-slate-900">Jan 2019 - May 2021</p>
                <p className="text-[13px] text-slate-900">Dallas, TX</p>
              </div>
            </div>
            <ul className="list-disc pl-5 text-[13px] text-slate-700 space-y-2 mt-2 font-medium">
              <li>Developed and maintained enterprise Java applications for financial services.</li>
              <li>Worked with MySQL and PostgreSQL databases to generate complex analytical reports.</li>
              <li>Collaborated with cross-functional teams to deliver project milestones on tight deadlines.</li>
              <li>Implemented comprehensive unit testing strategies using JUnit and Mockito, raising test coverage to 85%.</li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-slate-200 pt-5">
          <h2 className="text-sm font-bold uppercase text-[#3b82f6] mb-4 tracking-wider">Education</h2>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">University of Texas at Austin</h3>
              <p className="text-slate-700 text-[13px] font-medium">Bachelor of Science in Computer Science</p>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-bold text-slate-900">May 2018</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 2) {
    // Classic Professional
    return (
      <div className="p-12 space-y-8 font-serif relative w-full h-full text-slate-800 text-left bg-amber-50/20 box-border">
        <div className="border-b-4 border-slate-800 pb-6 mb-8 text-center">
          <h1 className="text-5xl font-bold uppercase tracking-[0.2em] text-slate-900">JOHN DOE</h1>
          <p className="text-[15px] text-slate-600 mt-4 tracking-wider">john.doe@email.com &nbsp;&bull;&nbsp; (555) 123-4567 &nbsp;&bull;&nbsp; Dallas, TX</p>
        </div>
        
        <div>
          <h2 className="text-[15px] font-bold uppercase text-slate-900 mb-4 border-b-2 border-slate-300 pb-2 tracking-[0.1em]">Professional Summary</h2>
          <p className="text-[14px] text-slate-800 leading-relaxed text-justify">
            An accomplished engineering leader with over a decade of experience driving technology strategy, scaling high-performing teams, and delivering mission-critical enterprise software. Proven expertise in cloud architecture, operational efficiency, and transforming complex business requirements into robust, scalable digital solutions.
          </p>
        </div>
        
        <div>
          <h2 className="text-[15px] font-bold uppercase text-slate-900 mb-4 border-b-2 border-slate-300 pb-2 tracking-[0.1em]">Professional Experience</h2>
          
          <div className="mt-6 mb-8">
            <div className="flex justify-between items-end font-bold text-[15px] text-slate-900 mb-2">
              <span>Director of Engineering | Enterprise Solutions LLC</span>
              <span className="text-[14px] font-normal italic">Jan 2018 - Present</span>
            </div>
            <ul className="list-disc pl-6 text-[14px] text-slate-800 space-y-2 mt-3 leading-relaxed">
              <li>Managed a $5M annual budget and a globally distributed team of 45 engineers.</li>
              <li>Reduced operational costs by 22% through strategic cloud migration to AWS.</li>
              <li>Led the successful launch of 3 flagship enterprise SaaS products, generating $10M+ in new revenue within the first year.</li>
              <li>Instituted agile methodologies that decreased time-to-market by 40%.</li>
            </ul>
          </div>
          
          <div className="mb-8">
            <div className="flex justify-between items-end font-bold text-[15px] text-slate-900 mb-2">
              <span>Senior Technical Lead | Apex Innovations</span>
              <span className="text-[14px] font-normal italic">Mar 2013 - Dec 2017</span>
            </div>
            <ul className="list-disc pl-6 text-[14px] text-slate-800 space-y-2 mt-3 leading-relaxed">
              <li>Architected and deployed a highly available microservices infrastructure handling 5M+ daily requests.</li>
              <li>Mentored 15 junior and mid-level developers, establishing a culture of technical excellence and continuous learning.</li>
              <li>Negotiated with third-party vendors to secure essential API integrations, expanding the product's capabilities by 50%.</li>
            </ul>
          </div>
        </div>
        
        <div>
          <h2 className="text-[15px] font-bold uppercase text-slate-900 mb-4 border-b-2 border-slate-300 pb-2 tracking-[0.1em]">Education</h2>
          <div className="mt-4 flex justify-between items-end font-bold text-[15px] text-slate-900">
            <span>Master of Business Administration (MBA)</span>
            <span className="text-[14px] font-normal italic">2012</span>
          </div>
          <p className="text-[14px] text-slate-800 mt-1">Southern Methodist University &nbsp;&bull;&nbsp; Dallas, TX</p>
          
          <div className="mt-5 flex justify-between items-end font-bold text-[15px] text-slate-900">
            <span>Bachelor of Science in Computer Science</span>
            <span className="text-[14px] font-normal italic">2009</span>
          </div>
          <p className="text-[14px] text-slate-800 mt-1">Texas A&M University &nbsp;&bull;&nbsp; College Station, TX</p>
        </div>
      </div>
    );
  }

  if (templateId === 3) {
    // Executive Template
    return (
      <div className="p-12 space-y-6 font-serif relative w-full h-full text-[#2c3e50] text-left bg-white box-border">
        <div className="flex flex-col items-center border-b-[3px] border-[#2c3e50] pb-6 mb-8 text-center">
          <h1 className="text-[2.75rem] font-bold tracking-widest text-[#1a252f] uppercase mb-2">Alex Johnson</h1>
          <h2 className="text-lg tracking-[0.3em] text-[#7f8c8d] uppercase mb-4">Chief Technology Officer</h2>
          <div className="flex gap-6 text-[13px] text-[#34495e] font-sans">
            <span className="flex items-center gap-1.5"><Mail className="w-4 h-4" /> alex.j@executive.com</span>
            <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> (555) 987-6543</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> New York, NY</span>
            <span className="flex items-center gap-1.5"><Linkedin className="w-4 h-4" /> in/alexjohnson-exec</span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-8 space-y-8">
            <section>
              <h3 className="text-xl font-bold uppercase tracking-widest text-[#2c3e50] border-b border-[#bdc3c7] pb-2 mb-4">Executive Profile</h3>
              <p className="text-[14px] leading-relaxed text-[#34495e] text-justify font-sans">Visionary technology executive with 15+ years of experience leading digital transformation, global engineering operations, and cloud strategy. Demonstrated success in aligning technology initiatives with corporate goals to drive revenue growth, operational efficiency, and market expansion. Proven ability to build and scale high-performing, cross-functional teams in hyper-growth environments.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold uppercase tracking-widest text-[#2c3e50] border-b border-[#bdc3c7] pb-2 mb-4">Professional Experience</h3>
              <div className="mb-6">
                <div className="flex justify-between items-baseline mb-1">
                  <h4 className="font-bold text-lg text-[#1a252f]">Global Tech Solutions</h4>
                  <span className="text-[13px] font-sans font-semibold text-[#7f8c8d]">2019 – Present</span>
                </div>
                <div className="text-[15px] font-bold text-[#34495e] mb-3 italic">Chief Technology Officer | New York, NY</div>
                <ul className="list-disc pl-5 text-[14px] font-sans text-[#34495e] space-y-2">
                  <li>Spearheaded a comprehensive cloud migration strategy, shifting 90% of legacy infrastructure to AWS, resulting in a 35% reduction in annual hosting costs.</li>
                  <li>Directed a global engineering organization of 120+ professionals across 4 international offices, fostering a culture of innovation and agile delivery.</li>
                  <li>Partnered with the executive board to secure $50M in Series C funding by defining the long-term product and technology roadmap.</li>
                </ul>
              </div>
              <div className="mb-6">
                <div className="flex justify-between items-baseline mb-1">
                  <h4 className="font-bold text-lg text-[#1a252f]">Innovate Finance</h4>
                  <span className="text-[13px] font-sans font-semibold text-[#7f8c8d]">2013 – 2019</span>
                </div>
                <div className="text-[15px] font-bold text-[#34495e] mb-3 italic">VP of Engineering | Chicago, IL</div>
                <ul className="list-disc pl-5 text-[14px] font-sans text-[#34495e] space-y-2">
                  <li>Led the architectural redesign of the core trading platform, increasing transaction throughput by 400% and reducing latency by 60%.</li>
                  <li>Implemented enterprise-wide DevSecOps practices, achieving SOC 2 Type II compliance within 8 months.</li>
                </ul>
              </div>
            </section>
          </div>

          <div className="col-span-4 space-y-8 font-sans">
            <section>
              <h3 className="text-[15px] font-bold uppercase tracking-widest text-[#2c3e50] border-b border-[#bdc3c7] pb-2 mb-4 font-serif">Core Competencies</h3>
              <ul className="space-y-3 text-[13px] text-[#34495e]">
                <li className="font-bold border-l-2 border-[#2c3e50] pl-3">Strategic Planning & Vision</li>
                <li className="font-bold border-l-2 border-[#2c3e50] pl-3">Cloud Architecture (AWS/GCP)</li>
                <li className="font-bold border-l-2 border-[#2c3e50] pl-3">P&L Management ($20M+)</li>
                <li className="font-bold border-l-2 border-[#2c3e50] pl-3">Enterprise Security & Compliance</li>
                <li className="font-bold border-l-2 border-[#2c3e50] pl-3">Global Team Leadership</li>
                <li className="font-bold border-l-2 border-[#2c3e50] pl-3">M&A Technology Integration</li>
              </ul>
            </section>

            <section>
              <h3 className="text-[15px] font-bold uppercase tracking-widest text-[#2c3e50] border-b border-[#bdc3c7] pb-2 mb-4 font-serif">Education</h3>
              <div className="mb-4">
                <h4 className="font-bold text-[#1a252f] text-[14px]">MBA, Executive Leadership</h4>
                <p className="text-[13px] text-[#7f8c8d] italic">Wharton School of Business</p>
              </div>
              <div>
                <h4 className="font-bold text-[#1a252f] text-[14px]">BS, Computer Science</h4>
                <p className="text-[13px] text-[#7f8c8d] italic">Stanford University</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 4) {
    // Creative Template
    return (
      <div className="flex w-full h-full font-sans text-slate-800 bg-white box-border relative overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-[35%] bg-rose-600 text-white p-10 flex flex-col justify-between relative z-10 shadow-2xl">
          <div>
            <div className="w-32 h-32 rounded-full border-4 border-white/20 bg-rose-500 mx-auto mb-8 flex items-center justify-center overflow-hidden shadow-lg">
              <span className="text-5xl font-black tracking-tighter text-white">AJ</span>
            </div>
            
            <div className="space-y-6 text-[13px] font-medium tracking-wide">
              <h3 className="text-rose-200 uppercase font-black tracking-widest text-xs border-b border-rose-500/50 pb-2 mb-4">Contact Me</h3>
              <div className="flex items-center gap-3"><Mail className="w-5 h-5 text-rose-300" /> alex.j@creative.io</div>
              <div className="flex items-center gap-3"><Phone className="w-5 h-5 text-rose-300" /> +1 234 567 8900</div>
              <div className="flex items-center gap-3"><MapPin className="w-5 h-5 text-rose-300" /> San Francisco, CA</div>
              <div className="flex items-center gap-3"><Globe className="w-5 h-5 text-rose-300" /> alexjohnson.design</div>
            </div>

            <div className="mt-12">
              <h3 className="text-rose-200 uppercase font-black tracking-widest text-xs border-b border-rose-500/50 pb-2 mb-4">Expertise</h3>
              <div className="space-y-4 text-[13px]">
                <div>
                  <div className="flex justify-between mb-1"><span>UI/UX Design</span><span className="text-rose-300">95%</span></div>
                  <div className="h-1.5 w-full bg-rose-800/50 rounded-full overflow-hidden"><div className="h-full bg-white w-[95%]"></div></div>
                </div>
                <div>
                  <div className="flex justify-between mb-1"><span>Figma & Prototyping</span><span className="text-rose-300">90%</span></div>
                  <div className="h-1.5 w-full bg-rose-800/50 rounded-full overflow-hidden"><div className="h-full bg-white w-[90%]"></div></div>
                </div>
                <div>
                  <div className="flex justify-between mb-1"><span>React & Tailwind</span><span className="text-rose-300">85%</span></div>
                  <div className="h-1.5 w-full bg-rose-800/50 rounded-full overflow-hidden"><div className="h-full bg-white w-[85%]"></div></div>
                </div>
                <div>
                  <div className="flex justify-between mb-1"><span>User Research</span><span className="text-rose-300">80%</span></div>
                  <div className="h-1.5 w-full bg-rose-800/50 rounded-full overflow-hidden"><div className="h-full bg-white w-[80%]"></div></div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="text-[11px] text-rose-300 font-bold uppercase tracking-widest text-center mt-8">
            Let's build something amazing
          </div>
        </div>

        {/* Right Content */}
        <div className="w-[65%] p-12 bg-gray-50 flex flex-col">
          <header className="mb-10">
            <h1 className="text-5xl font-black text-slate-900 tracking-tight leading-none mb-3">ALEX<br/><span className="text-rose-600">JOHNSON</span></h1>
            <h2 className="text-lg font-bold text-slate-500 uppercase tracking-widest">Senior Product Designer</h2>
          </header>

          <section className="mb-10">
             <h3 className="text-sm font-black uppercase text-slate-900 tracking-widest flex items-center gap-3 mb-4">
               <span className="w-8 h-px bg-rose-600 inline-block"></span> Profile
             </h3>
             <p className="text-[14px] text-slate-600 leading-relaxed font-medium">Passionate Product Designer with an obsession for pixel-perfect interfaces and seamless user experiences. Bridging the gap between aesthetic design and functional frontend development to deliver products that users love. Adept at turning complex problems into elegant, intuitive digital solutions.</p>
          </section>

          <section className="mb-10">
             <h3 className="text-sm font-black uppercase text-slate-900 tracking-widest flex items-center gap-3 mb-6">
               <span className="w-8 h-px bg-rose-600 inline-block"></span> Experience
             </h3>
             
             <div className="relative pl-6 border-l-2 border-rose-200 space-y-8">
               <div className="relative">
                 <div className="absolute w-3 h-3 bg-rose-600 rounded-full -left-[31px] top-1 border-4 border-gray-50"></div>
                 <h4 className="text-md font-bold text-slate-900">Lead UX Designer <span className="text-rose-600 text-sm ml-2 font-black">PixelCraft Agency</span></h4>
                 <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">2021 — Present</p>
                 <p className="text-[13px] text-slate-600 leading-relaxed">Directed the design system overhaul for 3 major SaaS clients, ensuring cross-platform consistency. Conducted 50+ user interviews to validate prototypes, increasing conversion rates by 25% on average.</p>
               </div>
               
               <div className="relative">
                 <div className="absolute w-3 h-3 bg-rose-400 rounded-full -left-[31px] top-1 border-4 border-gray-50"></div>
                 <h4 className="text-md font-bold text-slate-900">UI Designer <span className="text-rose-600 text-sm ml-2 font-black">Startup Hub</span></h4>
                 <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">2018 — 2021</p>
                 <p className="text-[13px] text-slate-600 leading-relaxed">Designed wireframes, mockups, and high-fidelity prototypes for early-stage startups. Collaborated closely with frontend devs to implement responsive web apps.</p>
               </div>
             </div>
          </section>
          
          <section>
             <h3 className="text-sm font-black uppercase text-slate-900 tracking-widest flex items-center gap-3 mb-4">
               <span className="w-8 h-px bg-rose-600 inline-block"></span> Education
             </h3>
             <div className="pl-6 text-[14px]">
               <h4 className="font-bold text-slate-900">BFA in Interaction Design</h4>
               <p className="text-slate-500 font-medium text-[13px]">California College of the Arts &nbsp;&bull;&nbsp; 2018</p>
             </div>
          </section>
        </div>
      </div>
    );
  }

  if (templateId === 5) {
    // Minimalist Template
    return (
      <div className="p-16 space-y-12 font-sans relative w-full h-full text-black text-left bg-white box-border">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-light tracking-[0.2em] uppercase">Alex Johnson</h1>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Software Engineer</p>
          <div className="flex justify-center gap-4 text-[11px] text-gray-400 mt-4 tracking-widest">
            <span>alex@minimal.com</span>
            <span>|</span>
            <span>+1 555 123 4567</span>
            <span>|</span>
            <span>San Francisco, CA</span>
          </div>
        </header>

        <section>
          <p className="text-[13px] leading-loose text-gray-600 text-center max-w-2xl mx-auto font-light">
            Dedicated software engineer focusing on writing clean, elegant, and efficient code. Experienced in full-stack development with a strong emphasis on frontend architecture and user experience.
          </p>
        </section>

        <div className="h-px w-12 bg-black mx-auto"></div>

        <section className="space-y-8">
          <div className="grid grid-cols-[120px_1fr] gap-8 items-start">
            <h3 className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold mt-1">Experience</h3>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <h4 className="text-sm font-semibold text-black">Tech Innovations Inc.</h4>
                  <span className="text-[11px] text-gray-400 tracking-widest">2021 — PRESENT</span>
                </div>
                <p className="text-[12px] text-gray-500 uppercase tracking-widest mb-3">Senior Frontend Engineer</p>
                <ul className="text-[13px] text-gray-600 space-y-2 font-light leading-relaxed">
                  <li>Architected a scalable React frontend for a B2B SaaS platform, improving load times by 45%.</li>
                  <li>Implemented comprehensive automated testing, bringing coverage from 30% to 90%.</li>
                </ul>
              </div>
              
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <h4 className="text-sm font-semibold text-black">Digital Solutions</h4>
                  <span className="text-[11px] text-gray-400 tracking-widest">2018 — 2021</span>
                </div>
                <p className="text-[12px] text-gray-500 uppercase tracking-widest mb-3">Full Stack Developer</p>
                <ul className="text-[13px] text-gray-600 space-y-2 font-light leading-relaxed">
                  <li>Developed RESTful APIs using Node.js and Express to serve 1M+ daily active users.</li>
                  <li>Designed and normalized PostgreSQL databases to support complex reporting features.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-8 items-start">
            <h3 className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold mt-1">Skills</h3>
            <div className="text-[13px] text-gray-600 font-light leading-loose">
              JavaScript (ES6+) &nbsp;&bull;&nbsp; TypeScript &nbsp;&bull;&nbsp; React &nbsp;&bull;&nbsp; Next.js &nbsp;&bull;&nbsp; Node.js<br/>
              Tailwind CSS &nbsp;&bull;&nbsp; GraphQL &nbsp;&bull;&nbsp; PostgreSQL &nbsp;&bull;&nbsp; Docker &nbsp;&bull;&nbsp; AWS
            </div>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-8 items-start">
            <h3 className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold mt-1">Education</h3>
            <div>
              <h4 className="text-sm font-semibold text-black">University of California, Berkeley</h4>
              <p className="text-[13px] text-gray-600 font-light mt-1">B.S. Computer Science — 2018</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (templateId === 6) {
    // Two Column Template
    return (
      <div className="flex w-full h-full font-sans text-slate-800 bg-white box-border border-t-8 border-emerald-600">
        <div className="w-[30%] bg-emerald-50 p-8 border-r border-emerald-100 flex flex-col gap-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 leading-tight mb-2">Alex<br/>Johnson</h1>
            <h2 className="text-emerald-700 font-bold text-sm tracking-wider uppercase">Project Manager</h2>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-emerald-200 pb-1">Contact</h3>
            <div className="text-[12px] space-y-3 font-medium text-slate-700">
              <div className="flex flex-col"><span className="text-emerald-700 font-bold mb-0.5">Phone</span> +1 (555) 789-0123</div>
              <div className="flex flex-col"><span className="text-emerald-700 font-bold mb-0.5">Email</span> alex.j@example.com</div>
              <div className="flex flex-col"><span className="text-emerald-700 font-bold mb-0.5">Location</span> Seattle, WA</div>
              <div className="flex flex-col"><span className="text-emerald-700 font-bold mb-0.5">LinkedIn</span> /in/alexj-pm</div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-emerald-200 pb-1">Skills</h3>
            <ul className="text-[12px] space-y-2 font-medium text-slate-700">
              <li>Agile / Scrum Methodologies</li>
              <li>Stakeholder Management</li>
              <li>Risk Mitigation</li>
              <li>Jira & Confluence</li>
              <li>Resource Allocation</li>
              <li>Budget Planning ($5M+)</li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-emerald-200 pb-1">Education</h3>
            <div className="text-[12px] text-slate-700">
              <p className="font-bold text-emerald-700">B.A. Business Admin</p>
              <p className="mb-1">University of Washington</p>
              <p className="text-slate-500 font-medium">Graduated 2016</p>
            </div>
          </div>
        </div>

        <div className="w-[70%] p-10 flex flex-col gap-8 bg-white">
          <section>
            <h3 className="text-lg font-bold text-slate-900 border-b-2 border-emerald-600 inline-block pb-1 mb-4">Profile</h3>
            <p className="text-[13px] text-slate-600 leading-relaxed">Detail-oriented and results-driven Project Manager with 8+ years of experience leading cross-functional teams to deliver complex software projects on time and under budget. Proven expertise in implementing Agile frameworks, streamlining workflows, and enhancing team productivity by 30%.</p>
          </section>

          <section className="flex-1">
            <h3 className="text-lg font-bold text-slate-900 border-b-2 border-emerald-600 inline-block pb-1 mb-6">Professional Experience</h3>
            
            <div className="space-y-8">
              <div>
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-slate-900 text-[15px]">Senior Project Manager</h4>
                  <span className="text-emerald-600 font-bold text-[13px]">2020 - Present</span>
                </div>
                <p className="text-slate-500 font-bold text-[13px] mb-3 uppercase tracking-wide">TechFlow Solutions | Seattle, WA</p>
                <ul className="list-disc pl-5 text-[13px] text-slate-600 space-y-2">
                  <li>Directed a portfolio of 12 enterprise software implementations with a combined budget of $8M, consistently delivering with a 98% client satisfaction rate.</li>
                  <li>Transitioned the engineering department from Waterfall to Agile/Scrum, reducing release cycles from 3 months to 2 weeks.</li>
                  <li>Facilitated daily stand-ups, sprint planning, and retrospective meetings for 4 distributed development teams.</li>
                </ul>
              </div>

              <div>
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-slate-900 text-[15px]">Project Manager</h4>
                  <span className="text-emerald-600 font-bold text-[13px]">2017 - 2020</span>
                </div>
                <p className="text-slate-500 font-bold text-[13px] mb-3 uppercase tracking-wide">Innovate Corp | Portland, OR</p>
                <ul className="list-disc pl-5 text-[13px] text-slate-600 space-y-2">
                  <li>Managed end-to-end delivery of a unified CRM platform for a Fortune 500 client.</li>
                  <li>Identified project risks early and developed mitigation strategies, preventing a potential $200K budget overrun.</li>
                  <li>Coordinated across UX/UI, QA, and Backend teams to ensure seamless feature integration.</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (templateId === 7) {
    // Technical Template
    return (
      <div className="p-12 font-mono relative w-full h-full text-slate-300 bg-[#0d1117] box-border border-t-[12px] border-blue-500">
        <div className="mb-8 border-b border-slate-700 pb-6">
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">&lt;Alex_Johnson /&gt;</h1>
          <p className="text-blue-400 text-sm mb-4">/* Systems Engineer & DevOps Architect */</p>
          <div className="flex flex-wrap gap-4 text-[12px] text-slate-400">
            <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-slate-500" /> user@localhost.com</span>
            <span className="flex items-center gap-1.5"><Github className="w-3.5 h-3.5 text-slate-500" /> github.com/alexj-dev</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-500" /> 127.0.0.1 (Austin, TX)</span>
          </div>
        </div>

        <div className="space-y-6 text-[13px]">
          <section>
            <h2 className="text-blue-400 font-bold text-lg mb-3 flex items-center gap-2">
              <span className="text-slate-600">$</span> cat summary.txt
            </h2>
            <p className="text-slate-300 leading-relaxed pl-4 border-l-2 border-slate-700">
              Senior DevOps Engineer specializing in building highly available, scalable infrastructure. Passionate about automating everything, writing robust infrastructure-as-code, and optimizing CI/CD pipelines. Strong Linux fundamentals and networking knowledge.
            </p>
          </section>

          <section>
            <h2 className="text-blue-400 font-bold text-lg mb-3 flex items-center gap-2">
              <span className="text-slate-600">$</span> ./list_skills.sh
            </h2>
            <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-slate-700">
              <div>
                <h3 className="text-white font-bold mb-1">Infrastructure</h3>
                <p className="text-slate-400">AWS, Terraform, CloudFormation, Ansible</p>
              </div>
              <div>
                <h3 className="text-white font-bold mb-1">Containers</h3>
                <p className="text-slate-400">Docker, Kubernetes (EKS), Helm</p>
              </div>
              <div>
                <h3 className="text-white font-bold mb-1">CI/CD</h3>
                <p className="text-slate-400">GitHub Actions, Jenkins, GitLab CI, ArgoCD</p>
              </div>
              <div>
                <h3 className="text-white font-bold mb-1">Languages</h3>
                <p className="text-slate-400">Bash, Python, Go, Rust</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-blue-400 font-bold text-lg mb-3 flex items-center gap-2">
              <span className="text-slate-600">$</span> ps -ef | grep experience
            </h2>
            <div className="pl-4 border-l-2 border-slate-700 space-y-6">
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="text-white font-bold text-[15px]">Lead DevOps Engineer @ CloudScale</h3>
                  <span className="text-slate-500 text-xs">2021-Present</span>
                </div>
                <ul className="list-disc pl-5 text-slate-400 space-y-1.5 mt-2 marker:text-blue-500">
                  <li>Designed and deployed multi-region EKS clusters using Terraform, serving 10M+ MAU.</li>
                  <li>Reduced AWS cloud spend by 40% through Spot instance usage and FinOps practices.</li>
                  <li>Built a self-service deployment platform for developers using ArgoCD and internal CLI tools.</li>
                </ul>
              </div>
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="text-white font-bold text-[15px]">Site Reliability Engineer @ DataCorp</h3>
                  <span className="text-slate-500 text-xs">2018-2021</span>
                </div>
                <ul className="list-disc pl-5 text-slate-400 space-y-1.5 mt-2 marker:text-blue-500">
                  <li>Implemented Prometheus/Grafana observability stack across 500+ microservices.</li>
                  <li>Automated database backups and disaster recovery procedures using Python scripts.</li>
                  <li>Participated in 24/7 on-call rotation, resolving critical incidents within strict SLAs.</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (templateId === 8) {
    // Functional Template
    return (
      <div className="p-12 space-y-8 font-sans relative w-full h-full text-slate-800 bg-white box-border">
        <header className="text-center border-b-2 border-indigo-600 pb-6">
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight uppercase">Alex Johnson</h1>
          <p className="text-indigo-600 font-bold mt-2 tracking-widest uppercase text-sm">Marketing & Communications Director</p>
          <div className="flex justify-center gap-6 text-[13px] text-slate-500 mt-4">
            <span>alex.marketing@example.com</span>
            <span>(555) 234-5678</span>
            <span>Boston, MA</span>
            <span>linkedin.com/in/alex-marketing</span>
          </div>
        </header>

        <section>
          <p className="text-[14px] text-slate-700 leading-relaxed font-medium text-center max-w-3xl mx-auto">
            Strategic Marketing Director with over 10 years of experience driving brand growth, leading high-impact campaigns, and expanding market share. Exceptional track record in digital marketing, team leadership, and budget optimization for B2C and B2B sectors.
          </p>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-bold text-slate-900 uppercase tracking-widest text-center mb-6">Areas of Expertise</h2>
          
          <div className="grid grid-cols-2 gap-8">
            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
              <h3 className="font-bold text-indigo-700 text-[15px] uppercase mb-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div> Digital Strategy
              </h3>
              <ul className="list-disc pl-5 text-[13px] text-slate-700 space-y-2">
                <li>Developed a comprehensive digital strategy that increased online sales by 150% in 12 months.</li>
                <li>Managed $2M+ annual ad budgets across Google, Meta, and LinkedIn with a consistent 4x ROAS.</li>
                <li>Implemented advanced SEO tactics, securing top 3 rankings for highly competitive industry keywords.</li>
              </ul>
            </div>
            
            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
              <h3 className="font-bold text-indigo-700 text-[15px] uppercase mb-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div> Brand Management
              </h3>
              <ul className="list-disc pl-5 text-[13px] text-slate-700 space-y-2">
                <li>Led complete corporate rebranding initiative, resulting in a 40% increase in brand recognition.</li>
                <li>Orchestrated PR campaigns that secured placements in Forbes, TechCrunch, and WSJ.</li>
                <li>Created and enforced comprehensive brand guidelines utilized by 500+ global employees.</li>
              </ul>
            </div>
            
            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
              <h3 className="font-bold text-indigo-700 text-[15px] uppercase mb-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div> Team Leadership
              </h3>
              <ul className="list-disc pl-5 text-[13px] text-slate-700 space-y-2">
                <li>Built and mentored a high-performing marketing team of 15 members from the ground up.</li>
                <li>Established KPIs and performance review systems to ensure continuous professional development.</li>
                <li>Streamlined cross-departmental collaboration between Sales and Marketing to align revenue goals.</li>
              </ul>
            </div>

            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
              <h3 className="font-bold text-indigo-700 text-[15px] uppercase mb-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div> Content & Campaigns
              </h3>
              <ul className="list-disc pl-5 text-[13px] text-slate-700 space-y-2">
                <li>Directed the production of a viral video campaign generating 5M+ views organically.</li>
                <li>Overhauled email marketing workflows, increasing open rates to 35% and CTR to 12%.</li>
                <li>Managed the successful launch of 4 major product lines with integrated multi-channel campaigns.</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900 uppercase tracking-widest text-center mb-6 mt-8">Work History</h2>
          <div className="flex justify-center gap-12 text-[14px] text-slate-700 font-medium">
            <div className="text-center">
              <p className="font-bold text-indigo-700">Marketing Director</p>
              <p>Global Brands Inc.</p>
              <p className="text-slate-500 text-xs">2019 - Present</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-indigo-700">Senior Marketing Manager</p>
              <p>Creative Solutions LLC</p>
              <p className="text-slate-500 text-xs">2014 - 2019</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-indigo-700">Digital Specialist</p>
              <p>NextGen Media</p>
              <p className="text-slate-500 text-xs">2010 - 2014</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (templateId === 9) {
    // Academic CV
    return (
      <div className="p-16 font-serif relative w-full h-full text-slate-900 bg-white box-border text-[13px] leading-relaxed">
        <header className="text-center mb-10 border-b-2 border-slate-900 pb-8">
          <h1 className="text-3xl font-bold uppercase tracking-widest mb-2">Dr. Emily Chen</h1>
          <p className="text-sm font-semibold tracking-wider text-slate-700">Department of Computer Science &bull; Stanford University</p>
          <div className="flex justify-center gap-4 mt-3 text-sm">
            <span>emily.chen@stanford.edu</span>
            <span>&bull;</span>
            <span>(650) 555-0199</span>
            <span>&bull;</span>
            <span>cs.stanford.edu/~echen</span>
          </div>
        </header>

        <section className="mb-8">
          <h2 className="text-lg font-bold uppercase tracking-widest border-b border-slate-300 mb-4 pb-1">Education</h2>
          <div className="space-y-4">
            <div className="flex justify-between">
              <div>
                <p className="font-bold">Ph.D. in Computer Science</p>
                <p className="italic">Stanford University</p>
                <p className="mt-1">Dissertation: "Machine Learning Optimization in Distributed Systems"</p>
                <p>Advisor: Prof. Andrew Ng</p>
              </div>
              <div className="text-right">
                <p>Expected 2027</p>
              </div>
            </div>
            <div className="flex justify-between">
              <div>
                <p className="font-bold">B.S. in Computer Science (Summa Cum Laude)</p>
                <p className="italic">Massachusetts Institute of Technology</p>
              </div>
              <div className="text-right">
                <p>2022</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold uppercase tracking-widest border-b border-slate-300 mb-4 pb-1">Research Experience</h2>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between font-bold mb-1">
                <span>Graduate Research Assistant</span>
                <span>Stanford AI Lab (2022 - Present)</span>
              </div>
              <ul className="list-disc pl-5 space-y-1">
                <li>Developed novel federated learning algorithms reducing communication overhead by 40%.</li>
                <li>Led a team of 3 undergraduate researchers in implementing distributed training pipelines.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold uppercase tracking-widest border-b border-slate-300 mb-4 pb-1">Publications</h2>
          <ol className="list-decimal pl-5 space-y-3">
            <li>
              <strong>Chen, E.</strong>, Smith, J., & Ng, A. (2025). "Efficient Federated Learning via Adaptive Quantization." <em>Proceedings of the International Conference on Machine Learning (ICML)</em>.
            </li>
            <li>
              Wang, T., <strong>Chen, E.</strong> (2024). "Distributed Systems for Large Language Models." <em>Journal of Artificial Intelligence Research</em>, 45(2), 112-145.
            </li>
          </ol>
        </section>
      </div>
    );
  }

  if (templateId === 10) {
    // Infographic
    return (
      <div className="p-0 font-sans relative w-full h-full text-slate-800 bg-[#f8fafc] box-border overflow-hidden">
        <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white p-12 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full blur-2xl translate-y-1/3 -translate-x-1/4"></div>
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-28 h-28 bg-white/20 rounded-full border-4 border-white/50 mb-4 flex items-center justify-center text-4xl font-black">JS</div>
            <h1 className="text-4xl font-black tracking-tight mb-2">Jason Smith</h1>
            <h2 className="text-lg font-medium text-violet-200 tracking-widest uppercase">UI/UX Designer & Developer</h2>
            <div className="flex gap-4 mt-6 text-sm font-medium">
              <span className="bg-black/20 px-4 py-1.5 rounded-full">New York, NY</span>
              <span className="bg-black/20 px-4 py-1.5 rounded-full">jason.uiux@email.com</span>
            </div>
          </div>
        </div>

        <div className="p-12 grid grid-cols-2 gap-12">
          <div>
            <h3 className="text-xl font-bold text-violet-900 mb-6 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 font-bold">1</div>
              Skill Matrix
            </h3>
            <div className="space-y-5">
              {[
                { name: 'UI/UX Design', val: 90 },
                { name: 'Figma / Prototyping', val: 95 },
                { name: 'React / Frontend', val: 80 },
                { name: 'CSS / Tailwind', val: 90 }
              ].map(skill => (
                <div key={skill.name}>
                  <div className="flex justify-between text-sm font-bold text-slate-700 mb-1">
                    <span>{skill.name}</span>
                    <span className="text-violet-600">{skill.val}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div className="bg-gradient-to-r from-violet-500 to-fuchsia-500 h-2.5 rounded-full" style={{ width: `${skill.val}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold text-violet-900 mb-6 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-fuchsia-100 flex items-center justify-center text-fuchsia-600 font-bold">2</div>
              Timeline
            </h3>
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-5 h-5 rounded-full border-4 border-white bg-violet-500 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 absolute left-0 md:left-1/2 -ml-2.5"></div>
                <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white p-4 rounded-xl shadow-sm border border-slate-100 ml-6 md:ml-0">
                  <div className="flex items-center justify-between space-x-2 mb-1">
                    <div className="font-bold text-slate-900 text-sm">Design Lead</div>
                    <time className="text-[10px] font-bold text-violet-500 bg-violet-50 px-2 py-0.5 rounded-full">2023-Present</time>
                  </div>
                  <div className="text-[12px] text-slate-500">Creative Agency X</div>
                </div>
              </div>

              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-5 h-5 rounded-full border-4 border-white bg-fuchsia-500 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 absolute left-0 md:left-1/2 -ml-2.5"></div>
                <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white p-4 rounded-xl shadow-sm border border-slate-100 ml-6 md:ml-0">
                  <div className="flex items-center justify-between space-x-2 mb-1">
                    <div className="font-bold text-slate-900 text-sm">UI Designer</div>
                    <time className="text-[10px] font-bold text-fuchsia-500 bg-fuchsia-50 px-2 py-0.5 rounded-full">2020-2023</time>
                  </div>
                  <div className="text-[12px] text-slate-500">Tech Startup Y</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 11) {
    // Combination
    return (
      <div className="p-0 font-sans relative w-full h-full text-slate-800 bg-white box-border flex flex-col">
        <div className="bg-[#1e293b] text-white p-10 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-1">Michael Chang</h1>
            <p className="text-emerald-400 font-medium tracking-wide">Data Scientist & Analytics Engineer</p>
          </div>
          <div className="text-right text-sm text-slate-300 space-y-1">
            <p>michael.c@example.com</p>
            <p>(555) 345-6789</p>
            <p>Chicago, IL</p>
          </div>
        </div>

        <div className="p-10 flex-1 grid grid-cols-[1fr_250px] gap-10">
          <div className="space-y-8">
            <section>
              <h2 className="text-lg font-bold text-slate-900 border-b-2 border-emerald-500 inline-block mb-4">Core Competencies</h2>
              <div className="grid grid-cols-2 gap-4 text-sm font-medium text-slate-700">
                <ul className="list-disc pl-5 space-y-1">
                  <li>Machine Learning Models</li>
                  <li>Predictive Analytics</li>
                  <li>A/B Testing & Experimentation</li>
                </ul>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Data Pipeline Architecture</li>
                  <li>Statistical Modeling</li>
                  <li>Data Visualization</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 border-b-2 border-emerald-500 inline-block mb-4">Professional Experience</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-bold text-slate-900">Senior Data Scientist <span className="text-slate-400 font-normal">| FinTech Solutions</span></h3>
                  <p className="text-sm text-emerald-600 font-medium mb-2">Jan 2021 - Present</p>
                  <ul className="list-disc pl-5 text-[13px] text-slate-600 space-y-1.5">
                    <li>Developed a churn prediction model with 89% accuracy, saving $1.2M annually.</li>
                    <li>Designed scalable ETL pipelines using Python and Apache Airflow.</li>
                    <li>Mentored 3 junior data analysts and established coding standards.</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Data Analyst <span className="text-slate-400 font-normal">| Retail Insights</span></h3>
                  <p className="text-sm text-emerald-600 font-medium mb-2">Jun 2017 - Dec 2020</p>
                  <ul className="list-disc pl-5 text-[13px] text-slate-600 space-y-1.5">
                    <li>Created Tableau dashboards for executive leadership, reducing reporting time by 15 hours/week.</li>
                    <li>Conducted A/B tests for e-commerce platform, increasing conversion rate by 12%.</li>
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
            <section className="mb-8">
              <h2 className="text-[15px] font-bold text-slate-900 mb-3 uppercase tracking-wider">Tech Stack</h2>
              <div className="flex flex-wrap gap-2">
                {['Python', 'SQL', 'R', 'TensorFlow', 'PyTorch', 'Tableau', 'Snowflake', 'AWS'].map(skill => (
                  <span key={skill} className="bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded text-[11px] font-bold shadow-sm">{skill}</span>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-[15px] font-bold text-slate-900 mb-3 uppercase tracking-wider">Education</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-bold text-slate-800">M.S. Data Science</p>
                  <p className="text-xs text-slate-600">Northwestern University</p>
                  <p className="text-[10px] font-bold text-emerald-600 mt-0.5">2017</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">B.S. Mathematics</p>
                  <p className="text-xs text-slate-600">University of Illinois</p>
                  <p className="text-[10px] font-bold text-emerald-600 mt-0.5">2015</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  // Generic fallback for any other custom ones created
  return (
    <div className="p-12 space-y-6 relative bg-slate-50 w-full h-full text-slate-800 flex flex-col items-center justify-center text-center border-4 border-dashed border-slate-300 box-border">
      <FileText className="w-24 h-24 text-slate-300 mb-6" />
      <h1 className="text-4xl font-bold text-slate-400">Custom Template</h1>
      <p className="text-lg text-slate-400 mt-4 max-w-md">This specific layout has been generated dynamically. In a production environment, this will render the full design structure.</p>
    </div>
  );

  return null;
};
